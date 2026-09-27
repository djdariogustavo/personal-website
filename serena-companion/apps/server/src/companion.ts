import Anthropic from '@anthropic-ai/sdk';
import { detectRisk, maxRisk, type RiskLevel } from '@serena/domain';

/**
 * Acompañante SERENA (6.10 y anexo "Acompañante de IA").
 *
 * - Perfil: escucha activa y calidez, sin rol profesional. No diagnostica, no
 *   indica tratamientos ni medicación, no reemplaza a un profesional.
 * - Seguridad en capas: (1) detector determinístico de riesgo (domain/risk.ts)
 *   que corre siempre; (2) el modelo devuelve su propia evaluación de riesgo en
 *   salida estructurada. El estado de cuidado se activa si CUALQUIERA de las dos
 *   lo marca como alto. El modelo nunca puede desactivarlo.
 * - Si el modelo no está configurado o falla, responde un acompañante básico
 *   con frases fijas revisadas (las del prototipo).
 */

export interface CompanionTurn {
  role: 'user' | 'companion';
  text: string;
}

export interface CompanionContext {
  nombre: string;
  rosterTexto: string;
  faena: string;
}

export interface CompanionReply {
  text: string;
  riesgo: RiskLevel;
  cuidado: boolean;
  fuente: 'modelo' | 'basico';
}

export interface Companion {
  reply(history: CompanionTurn[], userText: string, ctx: CompanionContext): Promise<CompanionReply>;
}

const SYSTEM_PROMPT = `Sos el Acompañante SERENA, parte de SERENA Companion™, una app de bienestar para trabajadores de minería que trabajan por rosters (por ejemplo 14 días en faena y 14 en casa), muchas veces en turno noche y lejos de su familia.

Tu rol es acompañar, no tratar. Actuás con la actitud de alguien que escucha de verdad: cálido, adulto, directo y sin juzgar. No sos un profesional de la salud y no lo simulás.

Cómo hablás:
- Español rioplatense con voseo ("¿Cómo estás?", "Contame", "Tomate un minuto").
- Mensajes cortos: 1 a 4 oraciones. La persona suele estar cansada y lee en el teléfono.
- Validás lo que siente antes de proponer algo. Preguntás más de lo que afirmás; una pregunta por mensaje como máximo.
- Nunca usás lenguaje clínico ni de diagnóstico ("paciente", "trastorno", "síntoma", "depresión", "ansiedad" como etiqueta, "diagnóstico"). No dramatizás.

Lo que NO hacés:
- No diagnosticás, no evaluás, no das indicaciones médicas, no hablás de medicación ni de dosis.
- No reemplazás a un profesional ni prometés confidencialidad absoluta ante riesgo de vida.
- No opinás sobre el desempeño laboral de la persona ni sobre su empresa o sus jefes.
- No inventás recursos, teléfonos ni servicios.

Lo que sí podés sugerir (solo recursos de la propia app): la respiración guiada de 2 o 5 minutos, las lecturas sobre dormir mejor en turno noche, volver a casa después del roster, manejo del estrés en el turno, alcohol y descanso (información sin juicio), el contacto con la familia (por ejemplo grabar un audio para mandarlo cuando haya señal), y hablar con una persona de la guardia de la faena.

Seguridad:
- Si la persona expresa intención o ideas de hacerse daño, de no querer vivir, o de estar en peligro, respondé con calma y presencia: agradecé que lo cuente, decí que estás ahí, que merece ayuda de una persona ahora, y preguntá si está en un lugar seguro. No cierres la conversación. En ese caso marcá riesgo "alto".
- Si hay desesperanza intensa sin mención de daño ("no doy más", "no aguanto más"), acompañá y ofrecé hablar con una persona de la guardia; marcá riesgo "posible".
- Si hay una emergencia física (accidente, lesión, gas, atrapamiento), indicá usar el botón "Ayuda" arriba a la derecha o avisar por radio, y marcá riesgo "alto".

Privacidad: la conversación se guarda cifrada y solo la persona puede verla. Su empresa nunca la ve y nunca se usa para evaluar desempeño.

Respondé siempre con el JSON pedido: "respuesta" es el mensaje para la persona; "riesgo" es tu evaluación ("ninguno", "posible" o "alto").`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    respuesta: { type: 'string', description: 'Mensaje para la persona, en español rioplatense.' },
    riesgo: { type: 'string', enum: ['ninguno', 'posible', 'alto'] },
  },
  required: ['respuesta', 'riesgo'],
  additionalProperties: false,
} as const;

const QUICK_REPLIES: Record<string, string> = {
  'Estoy cansado':
    'Tiene sentido, el turno noche se siente en el cuerpo. ¿Querés que hagamos juntos una respiración de 2 minutos, o preferís contarme cómo viene el día?',
  'Extraño a mi familia':
    'Es de lo más difícil del roster. ¿Hay algo que te gustaría decirles? Lo podemos dejar listo para cuando haya señal.',
  'No puedo dormir':
    'Dormir de día cuesta. Tengo algunas ideas cortas para el turno noche. ¿Te las paso, o querés contarme qué te despierta?',
  'Solo quiero charlar': 'Dale, acá estoy. ¿De qué tenés ganas de hablar?',
};

function careReply(nombre: string): string {
  return `Gracias por contármelo, ${nombre}. Estoy acá con vos y no me voy. Lo que sentís importa y no tenés que cargarlo solo. ¿Estás en un lugar seguro ahora?`;
}

/** Acompañante sin modelo: respuestas fijas y seguras. */
export class BasicCompanion implements Companion {
  async reply(_history: CompanionTurn[], userText: string, ctx: CompanionContext): Promise<CompanionReply> {
    const riesgo = detectRisk(userText);
    if (riesgo === 'alto') return { text: careReply(ctx.nombre), riesgo, cuidado: true, fuente: 'basico' };
    const text =
      QUICK_REPLIES[userText.trim()] ??
      (riesgo === 'posible'
        ? 'Suena a que venís cargando mucho. Gracias por decirlo. Si querés, te conecto con una persona de la guardia, o seguimos charlando acá, sin apuro.'
        : 'Te leo. Contame un poco más, sin apuro.');
    return { text, riesgo, cuidado: false, fuente: 'basico' };
  }
}

export class ClaudeCompanion implements Companion {
  private client = new Anthropic();
  private fallback = new BasicCompanion();

  constructor(
    private model: string,
    private effort: 'low' | 'medium' | 'high' = 'medium',
  ) {}

  async reply(history: CompanionTurn[], userText: string, ctx: CompanionContext): Promise<CompanionReply> {
    const detected = detectRisk(userText);

    const messages: Anthropic.Beta.BetaMessageParam[] = [];
    for (const t of history.slice(-30)) {
      const role = t.role === 'user' ? 'user' : 'assistant';
      if (messages.length === 0 && role === 'assistant') continue; // la conversación debe empezar con el usuario
      messages.push({ role, content: t.text });
    }
    messages.push({ role: 'user', content: userText });

    try {
      const response = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        // Si el modelo declina por política, la API reintenta con el modelo de respaldo recomendado.
        fallbacks: 'default',
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
          {
            type: 'text',
            text: `Contexto de la persona (no lo repitas textual): se llama ${ctx.nombre}; ${ctx.rosterTexto}; faena ${ctx.faena}.`,
          },
        ],
        thinking: { type: 'adaptive' },
        output_config: {
          effort: this.effort,
          format: { type: 'json_schema', schema: OUTPUT_SCHEMA },
        },
        messages,
      });

      if (response.stop_reason === 'refusal') throw new Error('refusal');
      const textBlock = response.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
      if (!textBlock) throw new Error('sin_texto');
      const parsed = JSON.parse(textBlock.text) as { respuesta?: unknown; riesgo?: unknown };
      const modelRisk: RiskLevel =
        parsed.riesgo === 'alto' || parsed.riesgo === 'posible' ? parsed.riesgo : 'ninguno';
      const riesgo = maxRisk(detected, modelRisk);
      const cuidado = riesgo === 'alto';
      let text = typeof parsed.respuesta === 'string' ? parsed.respuesta.trim() : '';
      if (!text) text = cuidado ? careReply(ctx.nombre) : 'Te leo. Contame un poco más, sin apuro.';
      return { text, riesgo, cuidado, fuente: 'modelo' };
    } catch (e) {
      if (e instanceof Anthropic.RateLimitError) console.warn('[serena][acompañante] límite de uso, respuesta básica');
      else if (e instanceof Anthropic.APIError) console.error(`[serena][acompañante] API ${e.status}`, e.message);
      else console.error('[serena][acompañante] error', e);
      return this.fallback.reply(history, userText, ctx);
    }
  }
}
