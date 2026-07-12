import { useMemo } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import styles from "./Markdown.module.css";

type MarkdownProps = {
  content: string;
};

export function Markdown({ content }: MarkdownProps) {
  const html = useMemo(
    () =>
      DOMPurify.sanitize(marked.parse(content, { async: false, breaks: true }) as string, {
        USE_PROFILES: { html: true },
      }),
    [content],
  );

  return <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: html }} />;
}
