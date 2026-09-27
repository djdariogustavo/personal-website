/**
 * Contenido de Recursos (6.12). Lenguaje simple, sin juicio y sin indicaciones
 * médicas. BORRADOR: debe revisarlo y aprobarlo el equipo de salud
 * ocupacional antes de publicar (ver docs/PENDIENTES.md).
 */

export interface Resource {
  slug: string;
  etiqueta: string;
  titulo: string;
  bajada: string;
  secciones: Array<{ id?: string; titulo: string; parrafos?: string[]; items?: string[] }>;
}

export const RESOURCES: Resource[] = [
  {
    slug: 'dormir-turno-noche',
    etiqueta: 'SUEÑO · 4 LECTURAS · 12 MIN',
    titulo: 'Dormir mejor en turno noche',
    bajada: 'Oscuridad, horarios y qué comer antes de acostarte.',
    secciones: [
      {
        titulo: '1. Oscuridad total',
        parrafos: ['El cuerpo usa la luz para saber qué hora es. Dormir de día con luz le dice que es hora de estar despierto.'],
        items: ['Cortinas opacas o antifaz.', 'Anteojos oscuros en el viaje de vuelta del turno, si es de día.', 'Pantallas lejos en la última media hora.'],
      },
      {
        titulo: '2. Un horario que se repita',
        parrafos: ['Acostarte más o menos a la misma hora cada día del turno ayuda a que el sueño llegue más rápido.'],
        items: ['Un bloque principal de sueño y, si hace falta, una siesta corta antes de entrar.', 'Avisale a tu entorno tus horas de descanso.'],
      },
      {
        titulo: '3. Qué comer y tomar',
        items: [
          'Una comida liviana antes de dormir; evitá las muy pesadas o picantes.',
          'El café y las bebidas energéticas hacen efecto por varias horas: mejor en la primera mitad del turno.',
          'El alcohol puede dar sueño, pero hace que el descanso sea más liviano y cortado.',
        ],
      },
      {
        titulo: '4. Silencio y temperatura',
        items: ['Tapones o ruido blanco si hay movimiento en el campamento.', 'Un cuarto fresco ayuda a dormir de corrido.'],
      },
    ],
  },
  {
    slug: 'volver-a-casa',
    etiqueta: 'FAMILIA · 6 MIN',
    titulo: 'Volver a casa después del roster',
    bajada: 'Desconectar del turno y reencontrarte con los tuyos.',
    secciones: [
      {
        titulo: 'El cuerpo también necesita volver',
        parrafos: [
          'Los primeros días de descanso suelen sentirse raros: cansancio, horarios cruzados, ganas de estar solo o de hacer todo junto. Es común.',
          'Recuperá el ritmo de día de a poco: luz natural a la mañana, comidas a horario y una siesta corta si hace falta.',
        ],
      },
      {
        id: 'reencuentro',
        titulo: 'El reencuentro, sin apuro',
        items: [
          'La casa siguió funcionando mientras no estabas: preguntá cómo se organizaron antes de cambiar cosas.',
          'Un rato a solas con cada hijo o hija vale más que un plan grande.',
          'Contá algo de tu turno, aunque sea poco. Ayuda a que no se sienta como dos vidas separadas.',
        ],
      },
      {
        titulo: 'Antes de volver a subir',
        items: ['Dejá acordado cuándo van a hablar mientras estés en faena.', 'Si la señal es mala, grabá audios cuando haya conexión.'],
      },
    ],
  },
  {
    slug: 'estres-en-el-turno',
    etiqueta: 'ESTRÉS · 5 MIN',
    titulo: 'Manejo del estrés en el turno',
    bajada: 'Pausas cortas que entran en cualquier momento.',
    secciones: [
      {
        titulo: 'Pausas de un minuto',
        items: [
          'Tres respiraciones lentas, soltando el aire más largo de lo que entra.',
          'Aflojá hombros y mandíbula; muchas veces se tensan sin darnos cuenta.',
          'Tomá agua. La deshidratación en altura se siente como cansancio.',
        ],
      },
      {
        titulo: 'Cuando se acumula',
        parrafos: [
          'Si hace varios días que venís cargado, hablarlo ayuda: con un compañero, con tu familia o con el acompañante de la app. Si querés hablar con una persona de la guardia, usá el botón Ayuda.',
        ],
      },
    ],
  },
  {
    slug: 'alcohol-y-descanso',
    etiqueta: 'INFORMACIÓN · 4 MIN',
    titulo: 'Alcohol y descanso',
    bajada: 'Información clara, sin juicio.',
    secciones: [
      {
        titulo: 'Qué pasa con el sueño',
        parrafos: [
          'El alcohol ayuda a dormirse más rápido, pero el sueño que viene después es más liviano y se corta más. Al otro día el cansancio se nota más.',
          'En turnos rotativos, el cuerpo ya está haciendo un esfuerzo para acomodarse: el alcohol suma a ese desgaste.',
        ],
      },
      {
        id: 'ayuda',
        titulo: 'Si querés hablarlo',
        parrafos: [
          'Si sentís que el consumo se está volviendo difícil de manejar, podés pedir ayuda de forma confidencial. Tu empresa no recibe tus datos individuales. Usá el botón Ayuda y elegí "Necesito hablar con alguien".',
        ],
      },
    ],
  },
];
