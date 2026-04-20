import React from "react";
import clsx from "clsx";
import { useLocation } from "@docusaurus/router";
import { HtmlClassNameProvider, ThemeClassNames } from "@docusaurus/theme-common";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import {
  BlogPostProvider,
  useBlogPost,
} from "@docusaurus/plugin-content-blog/client";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import BlogLayout from "@theme/BlogLayout";
import BlogPostItem from "@theme/BlogPostItem";
import BlogPostPaginator from "@theme/BlogPostPaginator";
import BlogPostPageMetadata from "@theme/BlogPostPage/Metadata";
import BlogPostPageStructuredData from "@theme/BlogPostPage/StructuredData";
import TOC from "@theme/TOC";
import ContentVisibility from "@theme/ContentVisibility";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import {
  getBlogArchiveEntryByPermalink,
  ensureBlogContentMetadata,
  getBlogMetadataByPermalink,
} from "../blogContentMetadataFallback";

function BlogPostMarkdown({ markdown }) {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);
  const tree = processor.runSync(processor.parse(markdown ?? ""));
  const content = toJsxRuntime(tree, {
    Fragment,
    jsx,
    jsxs,
    elementAttributeNameCase: "react",
    stylePropertyNameCase: "dom",
  });

  return <div className="markdown">{content}</div>;
}

function BlogPostPageContent({ sidebar, children }) {
  const { metadata, toc } = useBlogPost();
  const { nextItem, prevItem, frontMatter } = metadata;
  const {
    hide_table_of_contents: hideTableOfContents,
    toc_min_heading_level: tocMinHeadingLevel,
    toc_max_heading_level: tocMaxHeadingLevel,
  } = frontMatter;

  return (
    <BlogLayout
      sidebar={sidebar}
      toc={
        !hideTableOfContents && toc.length > 0 ? (
          <TOC
            toc={toc}
            minHeadingLevel={tocMinHeadingLevel}
            maxHeadingLevel={tocMaxHeadingLevel}
          />
        ) : undefined
      }>
      <ContentVisibility metadata={metadata} />
      <BlogPostItem>{children}</BlogPostItem>
      {(nextItem || prevItem) && (
        <BlogPostPaginator nextItem={nextItem} prevItem={prevItem} />
      )}
    </BlogLayout>
  );
}

export default function BlogPostPage(props) {
  const location = useLocation();
  const archiveEntry = getBlogArchiveEntryByPermalink(location.pathname);
  const blogPostContent = ensureBlogContentMetadata(
    props.content,
    getBlogMetadataByPermalink(location.pathname),
  );

  return (
    <BlogPostProvider content={blogPostContent} isBlogPostPage>
      <HtmlClassNameProvider
        className={clsx(
          ThemeClassNames.wrapper.blogPages,
          ThemeClassNames.page.blogPostPage,
        )}>
        <BlogPostPageMetadata />
        <BlogPostPageStructuredData />
        <BlogPostPageContent sidebar={props.sidebar}>
          {archiveEntry?.content ? (
            <BlogPostMarkdown markdown={archiveEntry.content} />
          ) : (
            React.createElement(blogPostContent)
          )}
        </BlogPostPageContent>
      </HtmlClassNameProvider>
    </BlogPostProvider>
  );
}
