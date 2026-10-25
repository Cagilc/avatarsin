import type { VexPersonality } from '@vex/operator';
import type { Personality } from '@vexstudio/format';

/**
 * The personality the studio published, turned into what the operator's prompt reads. It only
 * changes how Vex talks; what it may do comes from the grant.
 */

const LANGUAGE: Record<Personality['language'], string> = { es: 'español', en: 'inglés', pt: 'portugués', fr: 'francés' };
const TONE: Record<Personality['tone'], string> = {
  cercano: 'cercano y natural',
  profesional: 'profesional y claro',
  divertido: 'desenfadado, con algo de humor',
  serio: 'serio y sobrio',
  entusiasta: 'entusiasta y animado',
};

export function personalityFromStudio(p: Personality): VexPersonality {
  const traits = [
    `Tono ${TONE[p.tone]}`,
    p.formality >= 0.66 ? 'trato formal (de usted)' : p.formality <= 0.33 ? 'tuteo' : 'trato natural',
    p.verbosity <= 0.33 ? 'respuestas muy breves' : p.verbosity >= 0.66 ? 'respuestas detalladas' : 'respuestas de extensión media',
    p.emoji ? 'algún emoji de vez en cuando' : 'sin emojis',
    `responde en ${LANGUAGE[p.language]}`,
  ];
  const tone = [`${traits.join(', ')}.`, p.greeting ? `Saluda con: «${p.greeting}».` : '', p.about ? `Sobre ti: ${p.about}` : ''].filter(Boolean).join(' ');
  return { name: p.displayName, tone: tone.slice(0, 400), greets: true, talkMs: 1600 };
}
