const express = require('express');
const db = require('../db');
const { isAdmin, requireRole } = require('../auth');
const { HttpError } = require('../errors');
const { hardDelete } = require('../hardDelete');
const { date, number, text } = require('../validation');

const router = express.Router();

const columns = `id, employee_code AS employeeCode, name, designation, phone, email,
  DATE_FORMAT(date_of_birth, '%Y-%m-%d') AS dateOfBirth,
  location,
  DATE_FORMAT(joining_date, '%Y-%m-%d') AS joiningDate,
  commission_percent AS commissionPercent, is_active AS isActive`;

function ageFromDob(dob) {
  if (!dob) return null;
  const birth = new Date(`${dob}T00:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function formatEmployee(employee) {
  return {
    ...employee,
    commissionPercent: Number(employee.commissionPercent),
    isActive: Boolean(employee.isActive),
    age: ageFromDob(employee.dateOfBirth),
  };
}

function parseEmployee(body = {}) {
  const code = text(body.employeeCode, 'Employee code', { required: true, max: 20 }).toUpperCase();
  if (!/^[A-Z0-9_-]{2,20}$/.test(code)) {
    throw new HttpError(400, 'Employee code can only use letters, numbers, - and _ (2–20 characters).');
  }

  const phone = text(body.phone, 'Mobile number', { required: true, max: 10 }).replace(/\D/g, '');
  if (!/^[6-9]\d{9}$/.test(phone)) {
    throw new HttpError(400, 'Mobile number must be a valid 10-digit number.');
  }

  const email = text(body.email, 'Email', { max: 255 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'Email must be a valid email address.');
  }

  const dateOfBirth = date(body.dateOfBirth, 'Date of birth');
  if (dateOfBirth && dateOfBirth > new Date().toLocaleDateString('en-CA')) {
    throw new HttpError(400, 'Date of birth cannot be in the future.');
  }

  return {
    employee_code: code,
    name: text(body.name, 'Name', { required: true, max: 100 }),
    designation: text(body.designation, 'Designation', { required: true, max: 50 }),
    phone,
    email,
    date_of_birth: dateOfBirth,
    location: text(body.location, 'Location', { max: 120 }),
    joining_date: date(body.joiningDate, 'Joining date'),
    commission_percent: number(body.commissionPercent, 'Commission', { min: 0, max: 100 }) ?? 0,
    is_active: body.isActive === false ? 0 : 1,
  };
}

async function findEmployee(id) {
  const [rows] = await db.query(`SELECT ${columns} FROM employees WHERE id = ?`, [id]);
  return rows[0] ? formatEmployee(rows[0]) : null;
}

router.get('/', async (req, res) => {
  if (!isAdmin(req)) {
    const [employees] = await db.query(
      'SELECT id, employee_code AS employeeCode, name, designation FROM employees WHERE is_active = 1 ORDER BY name',
    );
    return res.json({ count: employees.length, employees });
  }

  const where = req.query.all === '1' ? '' : 'WHERE is_active = 1';
  const [employees] = await db.query(`SELECT ${columns} FROM employees ${where} ORDER BY name`);
  res.json({ count: employees.length, employees: employees.map(formatEmployee) });
});

router.get('/:id', requireRole('admin'), async (req, res) => {
  const employee = await findEmployee(req.params.id);
  if (!employee) {
    throw new HttpError(404, 'Employee not found.');
  }
  res.json({ employee });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('INSERT INTO employees SET ?', [parseEmployee(req.body)]);
  res.status(201).json({ employee: await findEmployee(result.insertId) });
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  const [result] = await db.query('UPDATE employees SET ? WHERE id = ?', [
    parseEmployee(req.body),
    req.params.id,
  ]);
  if (result.affectedRows === 0) {
    throw new HttpError(404, 'Employee not found.');
  }
  res.json({ employee: await findEmployee(req.params.id) });
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  await hardDelete('employees', req.params.id, 'Employee');
  res.json({ ok: true });
});

module.exports = router;
