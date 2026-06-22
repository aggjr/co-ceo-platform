/** Encerra pool MySQL aberto por imports transitivos (ex.: PatrimonyDailyRebuildService). */
export default async function globalTeardown(): Promise<void> {
  try {
    const { default: pool } = await import('../src/config/database');
    await pool.end();
  } catch {
    /* pool nunca instanciado nesta execucao */
  }
}
