import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

const preview: Preview = {
  parameters: {
    layout: 'padded',
    controls: {
      expanded: true,
    },
    options: {
      storySort: {
        order: ['Components'],
      },
    },
  },
}

export default preview
