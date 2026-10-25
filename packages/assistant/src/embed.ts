// Entry of the standalone script a host page loads from Vex Core: registers <vex-assistant> and
// the studio's <vex-avatar> it draws, nothing else.
import { defineVexAvatar } from '@vexstudio/runtime';
import { defineVexAssistant } from './element.ts';

defineVexAvatar();
defineVexAssistant();
