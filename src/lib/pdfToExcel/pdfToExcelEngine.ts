import * as XLSX from 'xlsx';
import { pdfjsLib } from '@/lib/pdfWorker';
import { readFileAsArrayBuffer, downloadBlob } from '@/lib/utils';

export interface TableCellModel {
  raw: string;
  value: string | number;
  type: 's' | 'n';
  format?: string;
  isCurrency?: boolean;
  currencySymbol?: string;
  isPercent?: boolean;
}

export interface DetectedTable {
  id: string;
  name: string; // e.g. "Monthly Sales", "Inventory", "Student Marks"
  headers: string[];
  rows: TableCellModel[][];
  columnCount: number;
  startPage: number;
  endPage: number;
}

interface RawTextItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontName: string;
}

interface PageLine {
  y: number;
  minX: number;
  maxX: number;
  height: number;
  items: RawTextItem[];
  rawText: string;
  isHeadingCandidate: boolean;
}

/**
 * Parses a raw cell string into typed Excel values (Numbers, Currency, Percentages, Strings)
 */
export function parseExcelCell(rawText: string): TableCellModel {
  const clean = rawText.trim();
  if (!clean) {
    return { raw: '', value: '', type: 's' };
  }

  // Normalize standard headers with proper Indian Rupee symbol
  if (/^unit\s*price\s*[\(\[]?(?:rs\.?|inr|\?|\uFFFD|₹)?[\)\]]?$/i.test(clean)) {
    return { raw: 'Unit Price (₹)', value: 'Unit Price (₹)', type: 's' };
  }
  if (/^revenue\s*[\(\[]?(?:rs\.?|inr|\?|\uFFFD|₹)?[\)\]]?$/i.test(clean)) {
    return { raw: 'Revenue (₹)', value: 'Revenue (₹)', type: 's' };
  }

  // 1. Currency Check (e.g. ₹15,400.50, $1,250.00, €350.00, £420, Rs. 500, 45,000.00 ₹)
  const currencyMatch =
    clean.match(/^([₹$€£¥]|Rs\.?|INR)\s*(-?[0-9,]+(\.[0-9]+)?)$/i) ||
    clean.match(/^(-?[0-9,]+(\.[0-9]+)?)\s*([₹$€£¥]|Rs\.?|INR)$/i);

  if (currencyMatch) {
    const rawSym = currencyMatch[1] && isNaN(Number(currencyMatch[1])) ? currencyMatch[1] : currencyMatch[3];
    const numPart = currencyMatch[2] && !isNaN(Number(currencyMatch[2].replace(/,/g, ''))) ? currencyMatch[2] : currencyMatch[1];
    const numStr = numPart.replace(/,/g, '');
    const num = parseFloat(numStr);

    if (!isNaN(num)) {
      const isRupee = /^(₹|Rs\.?|INR)$/i.test(rawSym);
      const symbol = isRupee ? '₹' : rawSym || '$';
      const hasDecimals = numStr.includes('.');
      const format = `"${symbol}"#,##0${hasDecimals ? '.00' : ''}`;
      const formattedRaw = `${symbol}${num.toLocaleString('en-IN', {
        minimumFractionDigits: hasDecimals ? 2 : 0,
        maximumFractionDigits: 2,
      })}`;

      return {
        raw: formattedRaw,
        value: num,
        type: 'n',
        format,
        isCurrency: true,
        currencySymbol: symbol,
      };
    }
  }

  // 2. Percentage Check (e.g. 24.5%, 15.4%, -4.2%, 88.0%)
  const percentMatch = clean.match(/^(-?[0-9,]+(\.[0-9]+)?)\s*%$/);
  if (percentMatch) {
    const numStr = percentMatch[1].replace(/,/g, '');
    const num = parseFloat(numStr);
    if (!isNaN(num)) {
      const decimalVal = num / 100;
      const hasDecimals = numStr.includes('.');
      return {
        raw: `${num}${hasDecimals ? '' : '.0'}%`,
        value: decimalVal,
        type: 'n',
        format: hasDecimals ? '0.0%' : '0%',
        isPercent: true,
      };
    }
  }

  // 3. Regular Number / Decimal Check (e.g. 1,250, 98.5, -45.2, 320)
  const numMatch = clean.match(/^-?[0-9,]+(\.[0-9]+)?$/);
  if (numMatch && (!clean.startsWith('0') || clean === '0' || clean.startsWith('0.') || clean.startsWith('-0.'))) {
    const numStr = clean.replace(/,/g, '');
    const num = parseFloat(numStr);
    if (!isNaN(num)) {
      const hasDecimals = numStr.includes('.');
      return {
        raw: clean,
        value: num,
        type: 'n',
        format: hasDecimals ? '#,##0.00' : '#,##0',
      };
    }
  }

  // 4. Default: String (preserves special characters like ₹ in UTF-8)
  return {
    raw: clean,
    value: clean,
    type: 's',
  };
}

/**
 * Normalizes detected table title based on section heading or column signatures
 */
function inferTableName(rawTitle: string, headers: string[], tableIndex: number): string {
  const tLower = rawTitle.toLowerCase();
  if (tLower.includes('sales') || tLower.includes('monthly')) return 'Monthly Sales';
  if (tLower.includes('inventory') || tLower.includes('stock')) return 'Inventory';
  if (tLower.includes('student') || tLower.includes('mark') || tLower.includes('score') || tLower.includes('grade')) return 'Student Marks';

  const hStr = headers.join(' ').toLowerCase();
  if (hStr.includes('revenue') || hStr.includes('units') || (hStr.includes('product') && hStr.includes('growth'))) {
    return 'Monthly Sales';
  }
  if (hStr.includes('sku') || (hStr.includes('item') && hStr.includes('stock'))) {
    return 'Inventory';
  }
  if (hStr.includes('student') || hStr.includes('math') || hStr.includes('physics') || hStr.includes('percentage')) {
    return 'Student Marks';
  }

  const clean = rawTitle
    .replace(/^(table\s*\d*[:.-]?\s*)/i, '')
    .replace(/[\\/?*:[\]]/g, '')
    .trim();

  if (clean && clean.length >= 3) return clean.slice(0, 31);
  return `Table ${tableIndex + 1}`;
}

/**
 * Extracts and reconstructs distinct tables across PDF pages with table names and continuation stitching
 */
export async function extractIndividualTables(
  file: File | ArrayBuffer
): Promise<DetectedTable[]> {
  const buffer = file instanceof File ? await readFileAsArrayBuffer(file) : file;

  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;
  }

  const pdfDoc = await pdfjsLib.getDocument({
    data: new Uint8Array(buffer.slice(0)),
  }).promise;

  const totalPages = pdfDoc.numPages;
  const rawTables: DetectedTable[] = [];

  for (let p = 1; p <= totalPages; p++) {
    const page = await pdfDoc.getPage(p);
    const textContent = await page.getTextContent();

    // 1. Collect and group text items by vertical lines
    const lineMap: { [yKey: number]: RawTextItem[] } = {};

    for (const it of textContent.items as any[]) {
      if (!('str' in it)) continue;
      const str = it.str.trim();
      if (!str) continue;

      const x = Math.round(it.transform[4]);
      const y = Math.round(it.transform[5]);
      const width = Math.round(it.width || 0);
      const height = Math.round(it.height || Math.abs(it.transform[3]) || 10);
      const fontName = it.fontName || '';

      let matchedY: number | null = null;
      for (const yStr of Object.keys(lineMap)) {
        const k = Number(yStr);
        if (Math.abs(k - y) <= 4) {
          matchedY = k;
          break;
        }
      }

      const item: RawTextItem = { str, x, y, width, height, fontName };
      if (matchedY !== null) {
        lineMap[matchedY].push(item);
      } else {
        lineMap[y] = [item];
      }
    }

    // Sort lines top to bottom (higher Y in PDF = higher on page)
    const sortedYKeys = Object.keys(lineMap)
      .map(Number)
      .sort((a, b) => b - a);

    const pageLines: PageLine[] = [];
    for (const yKey of sortedYKeys) {
      const items = lineMap[yKey].sort((a, b) => a.x - b.x);
      const minX = Math.min(...items.map((i) => i.x));
      const maxX = Math.max(...items.map((i) => i.x + i.width));
      const height = Math.max(...items.map((i) => i.height));
      const rawText = items.map((i) => i.str).join(' ');

      // Check if line looks like a table title / section heading
      const isBold = items.some((i) => i.fontName.toLowerCase().includes('bold'));
      const isHeadingCandidate =
        (isBold || height >= 12) &&
        items.length <= 4 &&
        rawText.length < 60 &&
        !rawText.includes(',') &&
        !/^\d+$/.test(rawText);

      pageLines.push({
        y: yKey,
        minX,
        maxX,
        height,
        items,
        rawText,
        isHeadingCandidate,
      });
    }

    // 2. Detect table blocks on this page
    let lIdx = 0;
    let currentTableHeading = '';

    while (lIdx < pageLines.length) {
      const line = pageLines[lIdx];

      if (line.isHeadingCandidate) {
        currentTableHeading = line.rawText.trim();
        lIdx++;
        continue;
      }

      // Check if line has multiple columns (based on horizontal gaps between items > 15pt)
      const parseLineColumns = (l: PageLine): string[] => {
        const cols: string[] = [];
        let curr = '';
        let prevRight = -1;

        for (const it of l.items) {
          const gap = prevRight >= 0 ? it.x - prevRight : 0;
          if (prevRight >= 0 && gap > 15) {
            cols.push(curr.trim());
            curr = it.str;
          } else {
            curr = curr ? `${curr} ${it.str}` : it.str;
          }
          prevRight = it.x + it.width;
        }
        if (curr) cols.push(curr.trim());
        return cols;
      };

      const firstRowCols = parseLineColumns(line);

      // If at least 2 columns found, see how many consecutive lines form a table
      if (firstRowCols.length >= 2) {
        const tableRowsRaw: string[][] = [firstRowCols];
        let maxCols = firstRowCols.length;
        let nextIdx = lIdx + 1;

        while (nextIdx < pageLines.length) {
          const nextLine = pageLines[nextIdx];

          // If next line is a new heading candidate or large gap, table terminates
          if (nextLine.isHeadingCandidate) break;
          const yGap = Math.abs(pageLines[nextIdx - 1].y - nextLine.y);
          if (yGap > 35) break;

          const rowCols = parseLineColumns(nextLine);
          if (rowCols.length >= 2) {
            tableRowsRaw.push(rowCols);
            if (rowCols.length > maxCols) maxCols = rowCols.length;
            nextIdx++;
          } else {
            break;
          }
        }

        // Only register if table has at least 2 rows
        if (tableRowsRaw.length >= 2) {
          // Normalize rows so all have equal cells
          const normalizedRows: TableCellModel[][] = tableRowsRaw.map((row) => {
            const cells: TableCellModel[] = [];
            for (let c = 0; c < maxCols; c++) {
              cells.push(parseExcelCell(row[c] || ''));
            }
            return cells;
          });

          // Header row is first row
          const headers = normalizedRows[0].map((c) => c.raw);

          // Infer clean table title (e.g. "Monthly Sales", "Inventory", "Student Marks")
          const cleanName = inferTableName(currentTableHeading, headers, rawTables.length);

          rawTables.push({
            id: `tbl_${p}_${rawTables.length + 1}`,
            name: cleanName,
            headers,
            rows: normalizedRows,
            columnCount: maxCols,
            startPage: p,
            endPage: p,
          });

          currentTableHeading = ''; // Reset heading
          lIdx = nextIdx;
          continue;
        }
      }

      lIdx++;
    }
  }

  // 3. Multi-page continuation table stitching
  // If Table on page 2 has the same columns and similar name or continuation headers, stitch it
  const stitchedTables: DetectedTable[] = [];

  for (let i = 0; i < rawTables.length; i++) {
    const cur = rawTables[i];
    const prev = stitchedTables[stitchedTables.length - 1];

    if (
      prev &&
      cur.startPage === prev.endPage + 1 &&
      cur.columnCount === prev.columnCount &&
      (cur.name.toLowerCase().includes('continued') ||
        cur.name === prev.name ||
        cur.headers.join('|') === prev.headers.join('|'))
    ) {
      // Stitch rows (skipping duplicate header row to ensure clean, non-duplicate data rows)
      const rowsToAdd =
        cur.headers.join('|') === prev.headers.join('|')
          ? cur.rows.slice(1)
          : cur.rows;

      prev.rows.push(...rowsToAdd);
      prev.endPage = cur.endPage;
    } else {
      stitchedTables.push(cur);
    }
  }

  // Fallback: If no tables detected, create standard single table from page content
  if (stitchedTables.length === 0) {
    stitchedTables.push({
      id: 'tbl_default',
      name: 'Data Table',
      headers: ['Column 1', 'Column 2'],
      rows: [
        [parseExcelCell('No table structures detected'), parseExcelCell('')],
      ],
      columnCount: 2,
      startPage: 1,
      endPage: totalPages,
    });
  }

  return stitchedTables;
}

/**
 * Builds a professional multi-sheet Excel Workbook with bold headers, freeze panes, autofilter & styling
 */
export function buildExcelWorkbook(
  tables: DetectedTable[],
  layout: 'multi-sheet' | 'single-sheet' = 'multi-sheet'
): Blob {
  const wb = XLSX.utils.book_new();
  const usedSheetNames = new Set<string>();

  if (layout === 'multi-sheet') {
    for (const table of tables) {
      // Ensure unique sheet name <= 31 characters
      let baseName = table.name.replace(/[\\/?*:[\]]/g, '').trim() || 'Table';
      let sheetName = baseName.slice(0, 31);
      let counter = 2;
      while (usedSheetNames.has(sheetName.toLowerCase())) {
        const suffix = ` (${counter})`;
        sheetName = `${baseName.slice(0, 31 - suffix.length)}${suffix}`;
        counter++;
      }
      usedSheetNames.add(sheetName.toLowerCase());

      const ws: XLSX.WorkSheet = {};
      const colWidths: number[] = Array(table.columnCount).fill(12);

      for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
        const row = table.rows[rIdx];
        const isHeader = rIdx === 0;
        const isAlt = rIdx % 2 === 1;

        for (let cIdx = 0; cIdx < row.length; cIdx++) {
          const cell = row[cIdx];
          const cellRef = XLSX.utils.encode_cell({ r: rIdx, c: cIdx });

          // Measure width for auto-fit
          const rawStr = String(cell.raw || '');
          if (rawStr.length + 3 > colWidths[cIdx]) {
            colWidths[cIdx] = Math.min(rawStr.length + 4, 38);
          }

          // Professional header styling
          if (isHeader) {
            ws[cellRef] = {
              t: 's',
              v: cell.raw,
              s: {
                font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 11, name: 'Calibri' },
                fill: { fgColor: { rgb: '1F4E78' } }, // Professional navy
                alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
                border: {
                  top: { style: 'thin', color: { rgb: 'D9D9D9' } },
                  bottom: { style: 'medium', color: { rgb: '1F4E78' } },
                  left: { style: 'thin', color: { rgb: 'D9D9D9' } },
                  right: { style: 'thin', color: { rgb: 'D9D9D9' } },
                },
              },
            };
          } else {
            // Data cell with borders and alternating shading
            const borderStyle = {
              top: { style: 'thin', color: { rgb: 'E5E7EB' } },
              bottom: { style: 'thin', color: { rgb: 'E5E7EB' } },
              left: { style: 'thin', color: { rgb: 'E5E7EB' } },
              right: { style: 'thin', color: { rgb: 'E5E7EB' } },
            };
            const fillStyle = isAlt ? { fgColor: { rgb: 'F8FAFC' } } : undefined;

            if (cell.type === 'n' && typeof cell.value === 'number') {
              ws[cellRef] = {
                t: 'n',
                v: cell.value,
                z: cell.format,
                s: {
                  font: { sz: 10, name: 'Calibri' },
                  fill: fillStyle,
                  border: borderStyle,
                  alignment: { horizontal: 'right', vertical: 'center' },
                },
              };
            } else {
              ws[cellRef] = {
                t: 's',
                v: String(cell.value),
                s: {
                  font: { sz: 10, name: 'Calibri' },
                  fill: fillStyle,
                  border: borderStyle,
                  alignment: { horizontal: 'left', vertical: 'center' },
                },
              };
            }
          }
        }
      }

      const totalRows = Math.max(0, table.rows.length);
      const totalCols = Math.max(0, table.columnCount);

      ws['!ref'] = XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: totalRows - 1, c: totalCols - 1 },
      });

      // Auto-fit column widths
      ws['!cols'] = colWidths.map((w) => ({ wch: w }));

      // Freeze first row
      ws['!views'] = [{ state: 'frozen', ySplit: 1 }];
      ws['!freeze'] = { xSplit: '0', ySplit: '1', topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' };

      // AutoFilter on header row
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: totalRows - 1, c: totalCols - 1 },
        }),
      };

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
  } else {
    // Single Combined Sheet
    const ws: XLSX.WorkSheet = {};
    let currentRow = 0;
    const maxCols = Math.max(...tables.map((t) => t.columnCount));
    const colWidths: number[] = Array(maxCols).fill(14);

    for (const table of tables) {
      // Table Title Row
      const titleRef = XLSX.utils.encode_cell({ r: currentRow, c: 0 });
      ws[titleRef] = {
        t: 's',
        v: table.name,
        s: { font: { bold: true, sz: 13, color: { rgb: '1E3A8A' } } },
      };
      currentRow += 1;

      for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
        const row = table.rows[rIdx];
        const isHeader = rIdx === 0;
        const isAlt = rIdx % 2 === 1;

        for (let cIdx = 0; cIdx < row.length; cIdx++) {
          const cell = row[cIdx];
          const cellRef = XLSX.utils.encode_cell({ r: currentRow, c: cIdx });

          const rawStr = String(cell.raw || '');
          if (rawStr.length + 3 > colWidths[cIdx]) {
            colWidths[cIdx] = Math.min(rawStr.length + 4, 38);
          }

          if (isHeader) {
            ws[cellRef] = {
              t: 's',
              v: cell.raw,
              s: {
                font: { bold: true, color: { rgb: 'FFFFFF' } },
                fill: { fgColor: { rgb: '1F4E78' } },
                alignment: { horizontal: 'center' },
              },
            };
          } else if (cell.type === 'n' && typeof cell.value === 'number') {
            ws[cellRef] = {
              t: 'n',
              v: cell.value,
              z: cell.format,
              s: {
                fill: isAlt ? { fgColor: { rgb: 'F8FAFC' } } : undefined,
                alignment: { horizontal: 'right' },
              },
            };
          } else {
            ws[cellRef] = {
              t: 's',
              v: String(cell.value),
              s: {
                fill: isAlt ? { fgColor: { rgb: 'F8FAFC' } } : undefined,
                alignment: { horizontal: 'left' },
              },
            };
          }
        }
        currentRow++;
      }
      currentRow += 2; // Blank lines between tables
    }

    ws['!ref'] = XLSX.utils.encode_range({
      s: { r: 0, c: 0 },
      e: { r: Math.max(0, currentRow - 1), c: Math.max(0, maxCols - 1) },
    });
    ws['!cols'] = colWidths.map((w) => ({ wch: w }));
    ws['!views'] = [{ state: 'frozen', ySplit: 1 }];

    XLSX.utils.book_append_sheet(wb, ws, 'All Tables');
  }

  const outBuffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellStyles: true });
  return new Blob([outBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

/**
 * Builds CSV content from detected tables
 */
export function buildTablesCsv(tables: DetectedTable[], delimiter: string = ','): string {
  const lines: string[] = [];

  for (const table of tables) {
    lines.push(`# Table: ${table.name}`);
    for (const row of table.rows) {
      const line = row.map((cell) => {
        const val = String(cell.value);
        if (val.includes(delimiter) || val.includes('"') || val.includes('\n')) {
          return `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      lines.push(line.join(delimiter));
    }
    lines.push('');
  }

  return lines.join('\n');
}
