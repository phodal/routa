const blogMetadataContext = require.context(
  "@generated/docusaurus-plugin-content-blog/default",
  false,
  /^\.\/site-docs-blog-.*\.json$/,
);

const fallbackMetadataByTitle = new Map(
  blogMetadataContext.keys().map((key) => {
    const mod = blogMetadataContext(key);
    const metadata = mod.default ?? mod;
    return [metadata.title, metadata];
  }),
);

function cloneContentWithFallback(content, metadata) {
  if (!content || !metadata) {
    return content;
  }

  return Object.assign(content, {
    metadata,
    frontMatter: content.frontMatter ?? metadata.frontMatter ?? {},
    assets: content.assets ?? {},
  });
}

export function ensureBlogContentMetadata(content) {
  if (!content || content.metadata) {
    return content;
  }

  const title = content.frontMatter?.title ?? content.contentTitle;
  if (!title) {
    return content;
  }

  return cloneContentWithFallback(content, fallbackMetadataByTitle.get(title));
}

export function normalizeBlogItems(items) {
  return items.map((item) => ({
    ...item,
    content: ensureBlogContentMetadata(item.content),
  }));
}
