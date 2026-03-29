const express = require('express');
const router = express.Router();
const path = require('path');

const REQUIRED_COLUMNS = [
  'email', 'first_name', 'last_name', 'phone',
  'product_name', 'product_price',
  'address_line', 'city', 'state', 'postal_code', 'country'
];

/* ─── Validate & process uploaded CSV rows ─── */
router.post('/api/csv/upload', (req, res) => {
  try {
    const { rows } = req.body;

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'No rows provided' });
    }

    const validRows = [];
    const errors = [];

    rows.forEach((row, index) => {
      const rowErrors = [];

      // Check required fields
      REQUIRED_COLUMNS.forEach(col => {
        if (!row[col] || String(row[col]).trim() === '') {
          rowErrors.push(`Missing ${col}`);
        }
      });

      // Validate email format
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email.trim())) {
        rowErrors.push('Invalid email format');
      }

      // Validate price
      if (row.product_price) {
        const price = parseFloat(row.product_price);
        if (isNaN(price) || price <= 0) {
          rowErrors.push('Invalid product_price (must be a positive number)');
        }
      }

      if (rowErrors.length > 0) {
        errors.push({ row: index + 1, email: row.email || 'N/A', errors: rowErrors });
      } else {
        // Normalize the row data
        validRows.push({
          index: index,
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
          country: row.country.trim(),
          status: 'Pending'
        });
      }
    });

    res.json({
      rows: validRows,
      errors,
      total_valid: validRows.length,
      total_invalid: errors.length,
      total: rows.length
    });

  } catch (error) {
    console.error('CSV upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

/* ─── Download demo CSV ─── */
router.get('/api/csv/demo', (req, res) => {
  const csvContent = [
    REQUIRED_COLUMNS.join(','),
    'john@example.com,John,Doe,+1234567890,Premium Widget,29.99,"123 Main St, Apt 4",New York,NY,10001,US',
    'jane@example.com,Jane,Smith,+1987654321,Deluxe Gadget,49.99,456 Oak Avenue,Los Angeles,CA,90001,US',
    'bob@example.com,Bob,Johnson,+1122334455,Standard Package,19.99,789 Pine Road,Chicago,IL,60601,US',
    'alice@example.com,Alice,Williams,+1555666777,Gold Membership,99.99,"321 Elm Blvd, Suite 200",Houston,TX,77001,US',
    'charlie@example.com,Charlie,Brown,+1888999000,Silver Plan,59.99,654 Maple Lane,Phoenix,AZ,85001,US'
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=demo_orders.csv');
  res.send(csvContent);
});

/* ─── Download demo store config CSV ─── */
router.get('/api/csv/demo-stores', (req, res) => {
  const csvContent = [
    'name,shop_domain,client_id,client_secret,max_orders',
    'My Store,my-store.myshopify.com,your_client_id,your_client_secret,100'
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=demo_stores.csv');
  res.send(csvContent);
});

module.exports = router;
