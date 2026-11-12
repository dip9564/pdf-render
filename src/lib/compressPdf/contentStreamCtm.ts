import { QpdfJsonDocument, QpdfJsonObjectEntry } from './qpdfEngine';

export interface ImagePlacement {
  pageIndex: number; // 0-based
  objectRef: string; // e.g. "4 0 R"
  resourceName: string; // e.g. "/Im0"
  displayedWidthPt: number;
  displayedHeightPt: number;
  effectiveDpiX: number;
  effectiveDpiY: number;
  maxEffectiveDpi: number;
  areaFractionOfPage: number;
}

export interface PagePlacementSummary {
  pageIndex: number;
  pageWidthPt: number;
  pageHeightPt: number;
  pageRotation: number;
  placements: ImagePlacement[];
  imageAreaCoverageFraction: number;
  uniqueImageRefs: Set<string>;
}

export interface DocumentCtmAnalysis {
  pageSummaries: PagePlacementSummary[];
  placementsByImageRef: Map<string, ImagePlacement[]>;
  /** Exact object keys needed at generalized decode level to walk content & form streams */
  referencedFormRefs: Set<string>;
}

type Matrix6 = [number, number, number, number, number, number];

const IDENTITY_MATRIX: Matrix6 = [1, 0, 0, 1, 0, 0];

function multiplyMatrix(cur: Matrix6, next: Matrix6): Matrix6 {
  // PDF row-vector concatenation: v' = v * next * cur
  const [a1, b1, c1, d1, e1, f1] = cur;
  const [a2, b2, c2, d2, e2, f2] = next;
  return [
    a2 * a1 + b2 * c1,
    a2 * b1 + b2 * d1,
    c2 * a1 + d2 * c1,
    c2 * b1 + d2 * d1,
    e2 * a1 + f2 * c1 + e1,
    e2 * b1 + f2 * d1 + f1,
  ];
}

export function resolveJsonValue(
  objs: Record<string, QpdfJsonObjectEntry>,
  val: unknown,
  seen = new Set<string>()
): unknown {
  if (typeof val === 'string' && /^\d+\s+\d+\s+R$/.test(val)) {
    if (seen.has(val)) return undefined;
    seen.add(val);
    const entry = objs[`obj:${val}`];
    if (!entry) return undefined;
    return entry.value ?? entry.stream ?? undefined;
  }
  return val;
}

export function resolveJsonDict(
  objs: Record<string, QpdfJsonObjectEntry>,
  val: unknown
): Record<string, unknown> | undefined {
  const resolved = resolveJsonValue(objs, val);
  if (!resolved || typeof resolved !== 'object') return undefined;
  if ('dict' in (resolved as Record<string, unknown>)) {
    return (resolved as { dict: Record<string, unknown> }).dict;
  }
  return resolved as Record<string, unknown>;
}

function getInheritedDictValue(
  objs: Record<string, QpdfJsonObjectEntry>,
  nodeDict: Record<string, unknown> | undefined,
  key: string
): unknown {
  let curr = nodeDict;
  let guard = 0;
  while (curr && guard++ < 32) {
    if (key in curr && curr[key] !== undefined && curr[key] !== null) {
      return curr[key];
    }
    if (!('/Parent' in curr)) break;
    curr = resolveJsonDict(objs, curr['/Parent']);
  }
  return undefined;
}

function getPageRect(
  objs: Record<string, QpdfJsonObjectEntry>,
  pageDict: Record<string, unknown> | undefined
): { widthPt: number; heightPt: number; rotation: number } {
  const rawCrop = getInheritedDictValue(objs, pageDict, '/CropBox');
  const rawMedia = getInheritedDictValue(objs, pageDict, '/MediaBox');
  const boxArr = (Array.isArray(rawCrop) ? rawCrop : Array.isArray(rawMedia) ? rawMedia : [0, 0, 595, 842]) as number[];
  const x1 = Number(boxArr[0]) || 0;
  const y1 = Number(boxArr[1]) || 0;
  const x2 = Number(boxArr[2]) || 595;
  const y2 = Number(boxArr[3]) || 842;
  const rawRot = Number(getInheritedDictValue(objs, pageDict, '/Rotate')) || 0;
  const rotation = ((rawRot % 360) + 360) % 360;
  const userUnit = Number(pageDict?.['/UserUnit']) || 1;
  return {
    widthPt: Math.abs(x2 - x1) * userUnit,
    heightPt: Math.abs(y2 - y1) * userUnit,
    rotation,
  };
}

/**
 * Collect all content stream + Form XObject + Annotation appearance stream refs
 * so QPDF can decode ONLY those tiny text streams cleanly before parsing.
 */
export function collectContentAndFormStreamRefs(docJson: QpdfJsonDocument): Set<string> {
  const objs = docJson.qpdf[1];
  const refs = new Set<string>();
  const visitedForms = new Set<string>();

  const walkResources = (resVal: unknown) => {
    const resDict = resolveJsonDict(objs, resVal);
    if (!resDict) return;
    const xObjMap = resolveJsonDict(objs, resDict['/XObject']);
    if (!xObjMap) return;
    for (const targetRef of Object.values(xObjMap)) {
      if (typeof targetRef !== 'string' || !/^\d+\s+\d+\s+R$/.test(targetRef)) continue;
      if (visitedForms.has(targetRef)) continue;
      const entry = objs[`obj:${targetRef}`];
      const dict = entry?.stream?.dict;
      if (dict && dict['/Subtype'] === '/Form') {
        visitedForms.add(targetRef);
        refs.add(targetRef);
        walkResources(dict['/Resources']);
      }
    }
  };

  for (const page of docJson.pages) {
    for (const cRef of page.contents) {
      if (typeof cRef === 'string') refs.add(cRef);
    }
    const pageDict = resolveJsonDict(objs, page.object);
    if (!pageDict) continue;
    walkResources(getInheritedDictValue(objs, pageDict, '/Resources'));

    // Annotation normal appearance streams (/Annots -> /AP -> /N)
    const annots = resolveJsonValue(objs, pageDict['/Annots']);
    if (Array.isArray(annots)) {
      for (const aRef of annots) {
        const annotDict = resolveJsonDict(objs, aRef);
        const ap = resolveJsonDict(objs, annotDict?.['/AP']);
        const normalAp = ap?.['/N'];
        if (typeof normalAp === 'string' && /^\d+\s+\d+\s+R$/.test(normalAp)) {
          const entry = objs[`obj:${normalAp}`];
          if (entry?.stream?.dict?.['/Subtype'] === '/Form') {
            if (!visitedForms.has(normalAp)) {
              visitedForms.add(normalAp);
              refs.add(normalAp);
              walkResources(entry.stream.dict['/Resources']);
            }
          } else {
            // /N can be a dict of appearance state names -> Form refs
            const stateDict = resolveJsonDict(objs, normalAp);
            if (stateDict) {
              for (const stateRef of Object.values(stateDict)) {
                if (typeof stateRef === 'string' && /^\d+\s+\d+\s+R$/.test(stateRef)) {
                  const stEntry = objs[`obj:${stateRef}`];
                  if (stEntry?.stream?.dict?.['/Subtype'] === '/Form' && !visitedForms.has(stateRef)) {
                    visitedForms.add(stateRef);
                    refs.add(stateRef);
                    walkResources(stEntry.stream.dict['/Resources']);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return refs;
}

const enum TokType {
  Num,
  Name,
  Op,
  Other,
}

interface PdfToken {
  type: TokType;
  value: string;
}

function isPdfWhitespace(ch: number): boolean {
  return ch === 0 || ch === 9 || ch === 10 || ch === 12 || ch === 13 || ch === 32;
}

function isPdfDelimiter(ch: number): boolean {
  return (
    ch === 40 || // (
    ch === 41 || // )
    ch === 60 || // <
    ch === 62 || // >
    ch === 91 || // [
    ch === 93 || // ]
    ch === 123 || // {
    ch === 125 || // }
    ch === 47 || // /
    ch === 37 // %
  );
}

/**
 * Lightweight spec-compliant PDF content-stream operator scanner for q / Q / cm / Do.
 * Safely skips comments, nested parens strings, hex strings, dicts, and inline BI..ID..EI data.
 */
function walkContentStreamOps(
  streamBytes: Uint8Array,
  initialCtm: Matrix6,
  userUnit: number,
  xObjectMap: Record<string, unknown>,
  fallbackXObjectMap: Record<string, unknown> | undefined,
  imageDimsByRef: Map<string, { width: number; height: number }>,
  formResolver: (
    formRef: string,
    ctm: Matrix6,
    fallbackMap: Record<string, unknown>
  ) => void,
  onImageDraw: (
    objectRef: string,
    resourceName: string,
    ctm: Matrix6
  ) => void
): void {
  const len = streamBytes.length;
  let pos = 0;
  let ctm: Matrix6 = [...initialCtm];
  const stack: Matrix6[] = [];
  const operands: PdfToken[] = [];

  const mergedXObjects = fallbackXObjectMap
    ? { ...fallbackXObjectMap, ...xObjectMap }
    : xObjectMap;

  const skipLiteralString = () => {
    pos++; // skip '('
    let depth = 1;
    while (pos < len && depth > 0) {
      const c = streamBytes[pos++];
      if (c === 92) {
        // '\' escape
        pos++;
      } else if (c === 40) {
        depth++;
      } else if (c === 41) {
        depth--;
      }
    }
  };

  const skipHexOrDict = () => {
    if (pos + 1 < len && streamBytes[pos + 1] === 60) {
      // Dictionary << ... >>
      pos += 2;
      let depth = 1;
      while (pos < len && depth > 0) {
        if (streamBytes[pos] === 40) {
          skipLiteralString();
          continue;
        }
        if (pos + 1 < len && streamBytes[pos] === 60 && streamBytes[pos + 1] === 60) {
          depth++;
          pos += 2;
          continue;
        }
        if (pos + 1 < len && streamBytes[pos] === 62 && streamBytes[pos + 1] === 62) {
          depth--;
          pos += 2;
          continue;
        }
        pos++;
      }
    } else {
      // Hex string <...>
      pos++;
      while (pos < len && streamBytes[pos] !== 62) pos++;
      if (pos < len) pos++;
    }
  };

  const skipArray = () => {
    pos++;
    let depth = 1;
    while (pos < len && depth > 0) {
      const c = streamBytes[pos];
      if (c === 40) {
        skipLiteralString();
      } else if (c === 60) {
        skipHexOrDict();
      } else if (c === 91) {
        depth++;
        pos++;
      } else if (c === 93) {
        depth--;
        pos++;
      } else {
        pos++;
      }
    }
  };

  const skipInlineImage = () => {
    // Advance until ID + whitespace, then scan for whitespace + EI + whitespace/EOF
    while (pos < len) {
      if (
        pos + 2 < len &&
        streamBytes[pos] === 73 && // I
        streamBytes[pos + 1] === 68 && // D
        isPdfWhitespace(streamBytes[pos + 2])
      ) {
        pos += 3;
        break;
      }
      if (streamBytes[pos] === 40) {
        skipLiteralString();
      } else {
        pos++;
      }
    }
    while (pos + 2 < len) {
      if (
        isPdfWhitespace(streamBytes[pos]) &&
        streamBytes[pos + 1] === 69 && // E
        streamBytes[pos + 2] === 73 && // I
        (pos + 3 >= len || isPdfWhitespace(streamBytes[pos + 3]))
      ) {
        pos += 3;
        return;
      }
      pos++;
    }
    pos = len;
  };

  while (pos < len) {
    const ch = streamBytes[pos];

    if (isPdfWhitespace(ch)) {
      pos++;
      continue;
    }

    if (ch === 37) {
      // '%' comment
      while (pos < len && streamBytes[pos] !== 10 && streamBytes[pos] !== 13) pos++;
      continue;
    }

    if (ch === 40) {
      skipLiteralString();
      operands.push({ type: TokType.Other, value: '' });
      if (operands.length > 16) operands.shift();
      continue;
    }

    if (ch === 60) {
      skipHexOrDict();
      operands.push({ type: TokType.Other, value: '' });
      if (operands.length > 16) operands.shift();
      continue;
    }

    if (ch === 91) {
      skipArray();
      operands.push({ type: TokType.Other, value: '' });
      if (operands.length > 16) operands.shift();
      continue;
    }

    if (ch === 47) {
      // /Name
      pos++;
      const start = pos;
      while (pos < len && !isPdfWhitespace(streamBytes[pos]) && !isPdfDelimiter(streamBytes[pos])) {
        pos++;
      }
      let name = '/';
      for (let i = start; i < pos; i++) name += String.fromCharCode(streamBytes[i]);
      operands.push({ type: TokType.Name, value: name });
      if (operands.length > 16) operands.shift();
      continue;
    }

    if (isPdfDelimiter(ch)) {
      pos++;
      continue;
    }

    // Read word (number or operator)
    const start = pos;
    while (pos < len && !isPdfWhitespace(streamBytes[pos]) && !isPdfDelimiter(streamBytes[pos])) {
      pos++;
    }
    let word = '';
    for (let i = start; i < pos; i++) word += String.fromCharCode(streamBytes[i]);
    if (!word) continue;

    // Fast path: check numeric or operator
    const firstC = word.charCodeAt(0);
    if (
      (firstC >= 48 && firstC <= 57) ||
      firstC === 45 ||
      firstC === 43 ||
      firstC === 46
    ) {
      const parsed = Number(word);
      if (!Number.isNaN(parsed)) {
        operands.push({ type: TokType.Num, value: word });
        if (operands.length > 16) operands.shift();
        continue;
      }
    }

    if (word === 'BI') {
      skipInlineImage();
      operands.length = 0;
      continue;
    }

    if (word === 'q') {
      if (stack.length < 128) {
        stack.push([...ctm]);
      }
      operands.length = 0;
      continue;
    }

    if (word === 'Q') {
      if (stack.length > 0) {
        ctm = stack.pop()!;
      }
      operands.length = 0;
      continue;
    }

    if (word === 'cm' && operands.length >= 6) {
      const n = operands.length;
      const m: Matrix6 = [
        Number(operands[n - 6].value) || 0,
        Number(operands[n - 5].value) || 0,
        Number(operands[n - 4].value) || 0,
        Number(operands[n - 3].value) || 0,
        Number(operands[n - 2].value) || 0,
        Number(operands[n - 1].value) || 0,
      ];
      ctm = multiplyMatrix(ctm, m);
      operands.length = 0;
      continue;
    }

    if (word === 'Do' && operands.length >= 1) {
      const nameTok = operands[operands.length - 1];
      if (nameTok.type === TokType.Name) {
        const resName = nameTok.value;
        const target = mergedXObjects[resName];
        if (typeof target === 'string' && /^\d+\s+\d+\s+R$/.test(target)) {
          if (imageDimsByRef.has(target)) {
            onImageDraw(target, resName, ctm);
          } else {
            formResolver(target, ctm, mergedXObjects);
          }
        }
      }
      operands.length = 0;
      continue;
    }

    // Any other graphics/text operator clears operand stack
    operands.length = 0;
    void userUnit;
  }
}

/**
 * Analyze exact displayed dimensions and effective DPI of every image XObject
 * placement across all pages (including Form XObjects & annotation appearances).
 */
export function analyzeDocumentCtmPlacements(
  docJson: QpdfJsonDocument,
  decodedStreams: Map<string, Uint8Array>
): DocumentCtmAnalysis {
  const objs = docJson.qpdf[1];
  const imageDimsByRef = new Map<string, { width: number; height: number }>();
  const referencedFormRefs = new Set<string>();

  // Catalog all image object dimensions from QPDF JSON
  for (const page of docJson.pages) {
    for (const img of page.images) {
      if (img.object && img.width > 0 && img.height > 0) {
        imageDimsByRef.set(img.object, { width: img.width, height: img.height });
      }
    }
  }
  for (const [key, entry] of Object.entries(objs)) {
    if (!key.startsWith('obj:') || !entry?.stream?.dict) continue;
    const dict = entry.stream.dict;
    if (dict['/Subtype'] === '/Image') {
      const ref = key.slice(4);
      const w = Number(dict['/Width']) || 0;
      const h = Number(dict['/Height']) || 0;
      if (w > 0 && h > 0) imageDimsByRef.set(ref, { width: w, height: h });
    }
  }

  const placementsByImageRef = new Map<string, ImagePlacement[]>();
  const pageSummaries: PagePlacementSummary[] = [];

  for (let pageIdx = 0; pageIdx < docJson.pages.length; pageIdx++) {
    const pageEntry = docJson.pages[pageIdx];
    const pageDict = resolveJsonDict(objs, pageEntry.object);
    const { widthPt, heightPt, rotation } = getPageRect(objs, pageDict);
    const userUnit = Number(pageDict?.['/UserUnit']) || 1;
    const pageAreaPt = Math.max(1, widthPt * heightPt);

    const resDict = resolveJsonDict(objs, getInheritedDictValue(objs, pageDict, '/Resources'));
    const pageXObjects = (resolveJsonDict(objs, resDict?.['/XObject']) ?? {}) as Record<string, unknown>;

    const pagePlacements: ImagePlacement[] = [];
    const uniqueRefsOnPage = new Set<string>();
    let areaSum = 0;

    const recordPlacement = (objectRef: string, resourceName: string, ctm: Matrix6) => {
      const dims = imageDimsByRef.get(objectRef);
      if (!dims) return;
      const dispW = Math.hypot(ctm[0], ctm[1]) * userUnit;
      const dispH = Math.hypot(ctm[2], ctm[3]) * userUnit;
      if (dispW <= 0.1 || dispH <= 0.1) return;

      const effectiveDpiX = dims.width / (dispW / 72);
      const effectiveDpiY = dims.height / (dispH / 72);
      const placement: ImagePlacement = {
        pageIndex: pageIdx,
        objectRef,
        resourceName,
        displayedWidthPt: dispW,
        displayedHeightPt: dispH,
        effectiveDpiX,
        effectiveDpiY,
        maxEffectiveDpi: Math.max(effectiveDpiX, effectiveDpiY),
        areaFractionOfPage: Math.min(1, (dispW * dispH) / pageAreaPt),
      };

      pagePlacements.push(placement);
      uniqueRefsOnPage.add(objectRef);
      areaSum += placement.areaFractionOfPage;

      const list = placementsByImageRef.get(objectRef);
      if (list) list.push(placement);
      else placementsByImageRef.set(objectRef, [placement]);
    };

    const formStack = new Set<string>();
    const walkForm = (
      formRef: string,
      ctm: Matrix6,
      fallbackXObjects: Record<string, unknown>
    ) => {
      if (formStack.has(formRef)) return;
      const entry = objs[`obj:${formRef}`];
      const dict = entry?.stream?.dict;
      if (!dict || dict['/Subtype'] !== '/Form') return;
      referencedFormRefs.add(formRef);

      const formStream = decodedStreams.get(formRef);
      if (!formStream || formStream.length === 0) return;

      const rawMatrix = dict['/Matrix'];
      let formCtm = ctm;
      if (Array.isArray(rawMatrix) && rawMatrix.length === 6) {
        formCtm = multiplyMatrix(ctm, [
          Number(rawMatrix[0]) || 0,
          Number(rawMatrix[1]) || 0,
          Number(rawMatrix[2]) || 0,
          Number(rawMatrix[3]) || 0,
          Number(rawMatrix[4]) || 0,
          Number(rawMatrix[5]) || 0,
        ]);
      }

      const formRes = resolveJsonDict(objs, dict['/Resources']);
      const formXObj = (resolveJsonDict(objs, formRes?.['/XObject']) ?? {}) as Record<
        string,
        unknown
      >;

      formStack.add(formRef);
      walkContentStreamOps(
        formStream,
        formCtm,
        userUnit,
        formXObj,
        fallbackXObjects,
        imageDimsByRef,
        walkForm,
        recordPlacement
      );
      formStack.delete(formRef);
    };

    // Concatenate multiple /Contents streams on a page safely with space separator
    const contentChunks: Uint8Array[] = [];
    for (const cRef of pageEntry.contents) {
      const buf = decodedStreams.get(cRef);
      if (buf && buf.length > 0) contentChunks.push(buf);
    }

    if (contentChunks.length > 0) {
      let combined: Uint8Array;
      if (contentChunks.length === 1) {
        combined = contentChunks[0];
      } else {
        const total = contentChunks.reduce((s, c) => s + c.length + 1, 0);
        combined = new Uint8Array(total);
        let offset = 0;
        for (const chunk of contentChunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
          combined[offset++] = 10; // '\n'
        }
      }

      walkContentStreamOps(
        combined,
        IDENTITY_MATRIX,
        userUnit,
        pageXObjects,
        undefined,
        imageDimsByRef,
        walkForm,
        recordPlacement
      );
    }

    // Also inspect annotation appearances on this page (stamps / custom buttons / vector overlays)
    const annots = resolveJsonValue(objs, pageDict?.['/Annots']);
    if (Array.isArray(annots)) {
      for (const aRef of annots) {
        const annotDict = resolveJsonDict(objs, aRef);
        const rect = Array.isArray(annotDict?.['/Rect']) ? (annotDict!['/Rect'] as number[]) : null;
        const ap = resolveJsonDict(objs, annotDict?.['/AP']);
        const apNorm = ap?.['/N'];
        const formCandidates: string[] = [];
        if (typeof apNorm === 'string' && /^\d+\s+\d+\s+R$/.test(apNorm)) {
          const stEntry = objs[`obj:${apNorm}`];
          if (stEntry?.stream?.dict?.['/Subtype'] === '/Form') {
            formCandidates.push(apNorm);
          } else {
            const stateDict = resolveJsonDict(objs, apNorm);
            if (stateDict) {
              for (const val of Object.values(stateDict)) {
                if (typeof val === 'string' && /^\d+\s+\d+\s+R$/.test(val)) {
                  formCandidates.push(val);
                }
              }
            }
          }
        }
        for (const apFormRef of formCandidates) {
          const apEntry = objs[`obj:${apFormRef}`];
          const apDict = apEntry?.stream?.dict;
          const bbox = Array.isArray(apDict?.['/BBox']) ? (apDict!['/BBox'] as number[]) : [0, 0, 1, 1];
          let baseCtm: Matrix6 = IDENTITY_MATRIX;
          if (rect && rect.length === 4 && bbox.length === 4) {
            const rw = Math.max(1, Math.abs(Number(rect[2]) - Number(rect[0])));
            const rh = Math.max(1, Math.abs(Number(rect[3]) - Number(rect[1])));
            const bw = Math.max(1e-3, Math.abs(Number(bbox[2]) - Number(bbox[0])));
            const bh = Math.max(1e-3, Math.abs(Number(bbox[3]) - Number(bbox[1])));
            baseCtm = [rw / bw, 0, 0, rh / bh, 0, 0];
          }
          walkForm(apFormRef, baseCtm, pageXObjects);
        }
      }
    }

    pageSummaries.push({
      pageIndex: pageIdx,
      pageWidthPt: widthPt,
      pageHeightPt: heightPt,
      pageRotation: rotation,
      placements: pagePlacements,
      imageAreaCoverageFraction: Math.min(1, areaSum),
      uniqueImageRefs: uniqueRefsOnPage,
    });
  }

  return {
    pageSummaries,
    placementsByImageRef,
    referencedFormRefs,
  };
}
