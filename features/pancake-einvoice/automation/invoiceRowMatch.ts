import type { InvoiceRow } from '../../../common/types/invoice';

/** Lowercase for matching; prefer vi-VN so Vietnamese casing rules apply when available. */
function localeLower(s: unknown) {
  const str = String(s);
  try {
    return str.toLocaleLowerCase('vi-VN');
  } catch {
    return str.toLowerCase();
  }
}

function normalizeName(value: unknown) {
  if (value == null) return '';
  return localeLower(
    String(value)
      .normalize('NFKC')
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Same as normalizeName but no spaces — matches "Tran Thuy Linh" ↔ "TranThuyLinh" on POS. */
export function normalizeNameKey(value: unknown) {
  return normalizeName(value).replace(/\s+/g, '');
}

function normalizePhone(value: unknown) {
  if (value == null) return '';
  return String(value).replace(/\D+/g, '');
}

export function findByBuyerName(invoiceRows: InvoiceRow[], rowText: string) {
  const rowNorm = normalizeName(rowText);
  if (!rowNorm) return null;
  const rowCompact = rowNorm.replace(/\s+/g, '');
  const rowTrim = String(rowText).trim();
  const rowLc = localeLower(rowTrim);
  const rowLcCompact = rowLc.replace(/\s+/g, '');

  return (
    invoiceRows.find((r) => {
      const nameNorm = normalizeName(r.buyerName);
      if (!nameNorm) return false;
      const nameCompact = nameNorm.replace(/\s+/g, '');
      const buyerTrim = String(r.buyerName).trim();
      const buyerLc = localeLower(buyerTrim);
      const buyerLcCompact = buyerLc.replace(/\s+/g, '');

      if (
        rowNorm === nameNorm ||
        rowNorm.includes(nameNorm) ||
        nameNorm.includes(rowNorm)
      ) {
        return true;
      }

      if (
        rowCompact === nameCompact ||
        rowCompact.includes(nameCompact) ||
        nameCompact.includes(rowCompact)
      ) {
        return true;
      }

      if (rowLc.includes(buyerLc) || buyerLc.includes(rowLc)) {
        return true;
      }

      if (
        rowLcCompact.includes(buyerLcCompact) ||
        buyerLcCompact.includes(rowLcCompact)
      ) {
        return true;
      }

      try {
        if (
          rowTrim.localeCompare(buyerTrim, 'vi', { sensitivity: 'base' }) ===
          0
        ) {
          return true;
        }
        if (
          rowTrim
            .replace(/\s+/g, '')
            .localeCompare(buyerTrim.replace(/\s+/g, ''), 'vi', {
              sensitivity: 'base',
            }) === 0
        ) {
          return true;
        }
      } catch {
        if (rowLc === buyerLc) {
          return true;
        }
      }

      return false;
    }) || null
  );
}

export function findByPhone(invoiceRows: InvoiceRow[], phoneRaw: string) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return null;
  return (
    invoiceRows.find((r) => normalizePhone(r.phone) === phone) || null
  );
}
