import type { AnchorHTMLAttributes, ImgHTMLAttributes } from 'react';
import ReactMarkdown, { defaultUrlTransform, type ExtraProps, type UrlTransform } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { stripAccordionOpenStateFromMarkdown } from '../utils/markdownEditorAccordion';
import { repairMarkdownLinksInRawHtmlBlocks } from '../utils/markdownEditorInlineHtml';
import { TccAccordionMarkdownDetails, TccAccordionMarkdownDiv } from './markdown/TccAccordionMarkdown';
import { OPEN_IN_NEW_WINDOW_TITLE } from '../constants/markdownLink';
import { parseYoutubeVideoIdFromMarkdownImageSrc } from '../utils/youtubeMarkdown';

export const ARTICLE_MARKDOWN_REMARK_PLUGINS = [remarkBreaks, remarkGfm] as const;
export const ARTICLE_MARKDOWN_REHYPE_PLUGINS = [rehypeRaw] as const;

export function MarkdownLink({ node: _node, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & ExtraProps) {
  const openInNewWindow = props.title === OPEN_IN_NEW_WINDOW_TITLE;
  return (
    <a
      {...props}
      title={openInNewWindow ? undefined : props.title}
      target={openInNewWindow ? '_blank' : props.target}
      rel={openInNewWindow ? 'noopener noreferrer' : props.rel}
    />
  );
}

function MarkdownImage({ node: _node, ...props }: ImgHTMLAttributes<HTMLImageElement> & ExtraProps) {
  const id = parseYoutubeVideoIdFromMarkdownImageSrc(props.src);
  if (id) {
    const label = props.alt?.trim() || 'YouTube video';
    return (
      <div className="markdown-youtube-embed">
        <div className="markdown-youtube-inner">
          <iframe
            src={`https://www.youtube.com/embed/${id}`}
            title={label}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            loading="lazy"
          />
        </div>
      </div>
    );
  }
  return <img {...props} />;
}

/** `defaultUrlTransform` strips non-http(s) protocols; keep our virtual `youtube://` image URLs for embeds. */
const articleMarkdownUrlTransform: UrlTransform = (url, key) => {
  if (key === 'src' && parseYoutubeVideoIdFromMarkdownImageSrc(url)) return url;
  return defaultUrlTransform(url);
};

const articleMarkdownComponents = {
  a: MarkdownLink,
  img: MarkdownImage,
  div: TccAccordionMarkdownDiv,
  details: TccAccordionMarkdownDetails,
} as const;

type ArticleMarkdownProps = {
  markdown: string;
  className?: string;
};

/** Shared remark/rehype stack and components for article-style markdown (public + admin preview). */
export function ArticleMarkdown({ markdown, className }: ArticleMarkdownProps) {
  return (
    <div className={className ?? 'markdown-content max-w-none'}>
      <ReactMarkdown
        remarkPlugins={[...ARTICLE_MARKDOWN_REMARK_PLUGINS]}
        rehypePlugins={[...ARTICLE_MARKDOWN_REHYPE_PLUGINS]}
        urlTransform={articleMarkdownUrlTransform}
        components={articleMarkdownComponents}
      >
        {stripAccordionOpenStateFromMarkdown(repairMarkdownLinksInRawHtmlBlocks(markdown))}
      </ReactMarkdown>
    </div>
  );
}
