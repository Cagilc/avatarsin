import type { VexAssistantElement } from '@vex/assistant';
import type { DetailedHTMLProps, HTMLAttributes, RefObject } from 'react';

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      /** The operator panel as one tag; token, context and suggestions are set as properties through the ref. */
      'vex-assistant': DetailedHTMLProps<HTMLAttributes<VexAssistantElement>, VexAssistantElement> & { api?: string; 'demo-user'?: string; avatar?: 'off'; ref?: RefObject<VexAssistantElement | null> };
    }
  }
}
