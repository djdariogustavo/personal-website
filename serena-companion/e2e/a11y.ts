import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

/** Reglas WCAG 2.0, 2.1 y 2.2, niveles A y AA, más las buenas prácticas de axe. */
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

export interface Hallazgo {
  pantalla: string;
  regla: string;
  impacto: string | null | undefined;
  ayuda: string;
  nodos: string[];
}

/** Audita la pantalla actual con axe-core y acumula los hallazgos. */
export async function auditar(page: Page, pantalla: string, hallazgos: Hallazgo[]) {
  // Se espera a que terminen las animaciones de entrada para medir el contraste final.
  await page.waitForTimeout(400);
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  for (const v of r.violations)
    hallazgos.push({ pantalla, regla: v.id, impacto: v.impact, ayuda: v.help, nodos: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + (n.failureSummary ? ` — ${n.failureSummary.split('\n')[1]?.trim() ?? ''}` : '')) });
}

export async function informar(hallazgos: Hallazgo[], testInfo: TestInfo) {
  await testInfo.attach('hallazgos-axe.json', { body: JSON.stringify(hallazgos, null, 2), contentType: 'application/json' });
  if (hallazgos.length)
    console.log(hallazgos.map((h) => `• [${h.impacto}] ${h.pantalla} · ${h.regla}: ${h.ayuda}\n    ${h.nodos.join('\n    ')}`).join('\n'));
}
