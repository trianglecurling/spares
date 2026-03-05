/**
 * Generates Tailwind CSS for article HTML content.
 * Scans the HTML for class names and produces minimal CSS.
 */
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { articleTailwindConfig } from './tailwind-config.js';

const SOURCE_CSS = '@tailwind base; @tailwind components; @tailwind utilities;';

export async function generateArticleCss(htmlContent: string): Promise<string> {
  const tempFile = join(tmpdir(), `article-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  await writeFile(tempFile, htmlContent, 'utf-8');

  try {
    const config = {
      ...articleTailwindConfig,
      content: [tempFile],
    };

    const result = await postcss([
      tailwindcss(config),
      autoprefixer(),
    ]).process(SOURCE_CSS, { from: undefined });

    return result.css;
  } finally {
    await unlink(tempFile).catch(() => {});
  }
}
