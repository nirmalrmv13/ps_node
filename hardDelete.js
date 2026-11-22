const db = require('./db');
const { HttpError } = require('./errors');

/** Permanently remove a row. Fails clearly when other records still reference it. */
async function hardDelete(table, id, label) {
  try {
    const [result] = await db.query(`DELETE FROM \`${table}\` WHERE id = ?`, [id]);
    if (result.affectedRows === 0) {
      throw new HttpError(404, `${label} not found.`);
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err.code === 'ER_ROW_IS_REFERENCED_2' || err.errno === 1451) {
      throw new HttpError(
        409,
        `Cannot delete this ${label.toLowerCase()} because it is used in other records.`,
      );
    }
    throw err;
  }
}

module.exports = { hardDelete };
