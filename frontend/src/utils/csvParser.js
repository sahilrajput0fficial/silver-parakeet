import Papa from 'papaparse';

const REQUIRED_ORDER_COLUMNS = [
  'email', 'first_name', 'last_name', 'phone',
  'product_name', 'product_price',
  'address_line', 'city', 'state', 'postal_code', 'country'
];

const REQUIRED_STORE_COLUMNS = [
  'name', 'shop_domain', 'client_id', 'client_secret', 'max_orders'
];

/**
 * Parse an order CSV file (client-side).
 * Returns { data, errors, meta }.
 */
export function parseOrderCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        const { data, errors: parseErrors, meta } = results;

        // Validate columns
        const headers = meta.fields || [];
        const missingCols = REQUIRED_ORDER_COLUMNS.filter(col => !headers.includes(col));

        if (missingCols.length > 0) {
          return resolve({
            data: [],
            errors: [{ type: 'ColumnError', message: `Missing columns: ${missingCols.join(', ')}` }],
            meta,
            isValid: false
          });
        }

        // Row-level validation
        const validRows = [];
        const rowErrors = [];

        data.forEach((row, index) => {
          const issues = [];

          if (!row.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) {
            issues.push('Invalid or missing email');
          }

          const price = parseFloat(row.product_price);
          if (isNaN(price) || price <= 0) {
            issues.push('Invalid product_price');
          }

          if (!row.first_name?.trim()) issues.push('Missing first_name');
          if (!row.last_name?.trim()) issues.push('Missing last_name');
          if (!row.product_name?.trim()) issues.push('Missing product_name');
          if (!row.address_line?.trim()) issues.push('Missing address_line');
          if (!row.city?.trim()) issues.push('Missing city');
          if (!row.state?.trim()) issues.push('Missing state');
          if (!row.postal_code?.toString().trim()) issues.push('Missing postal_code');
          if (!row.country?.trim()) issues.push('Missing country');

          if (issues.length > 0) {
            rowErrors.push({ row: index + 1, email: row.email || 'N/A', issues });
          } else {
            validRows.push({
              ...row,
              email: row.email.trim(),
              first_name: row.first_name.trim(),
              last_name: row.last_name.trim(),
              phone: (row.phone || '').trim(),
              product_name: row.product_name.trim(),
              product_price: parseFloat(row.product_price).toFixed(2),
              address_line: row.address_line.trim(),
              city: row.city.trim(),
              state: row.state.trim(),
              postal_code: String(row.postal_code).trim(),
              country: row.country.trim()
            });
          }
        });

        resolve({
          data: validRows,
          errors: rowErrors,
          parseErrors,
          meta,
          isValid: rowErrors.length === 0 && validRows.length > 0,
          totalValid: validRows.length,
          totalInvalid: rowErrors.length
        });
      },
      error: (err) => {
        reject(err);
      }
    });
  });
}

/**
 * Parse a store config CSV file (client-side).
 */
export function parseStoreCsv(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim().toLowerCase().replace(/\s+/g, '_'),
      complete: (results) => {
        const { data, meta } = results;
        const headers = meta.fields || [];
        const missingCols = REQUIRED_STORE_COLUMNS.filter(col => !headers.includes(col));

        if (missingCols.length > 0) {
          return resolve({
            data: [],
            errors: [{ type: 'ColumnError', message: `Missing columns: ${missingCols.join(', ')}` }],
            isValid: false
          });
        }

        resolve({ data, errors: [], isValid: data.length > 0 });
      },
      error: reject
    });
  });
}

/**
 * Generate CSV from failed rows for export.
 */
export function exportFailedRows(failedRows) {
  const csv = Papa.unparse(failedRows.map(row => ({
    email: row.email,
    first_name: row.first_name,
    last_name: row.last_name,
    phone: row.phone,
    product_name: row.product_name,
    product_price: row.product_price,
    address_line: row.address_line,
    city: row.city,
    state: row.state,
    postal_code: row.postal_code,
    country: row.country,
    error: row.error || row.status
  })));

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `failed_rows_${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
