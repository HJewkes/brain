const NOTION_UUID_LINK = /\[([^\]]+)\]\(https?:\/\/(?:www\.)?notion\.so\/[^\s)]*[a-f0-9]{32}\)/g;
const NOTION_PROPERTIES_TABLE = /^\| Property \| Value \|\n\| --- \| --- \|\n((?:\|[^\n]+\|\n)*)/m;

export function isNotionExport(content: string): boolean {
  NOTION_UUID_LINK.lastIndex = 0;
  return NOTION_UUID_LINK.test(content);
}

export function extractNotionProperties(content: string): {
  properties: Record<string, string>;
  cleanedContent: string;
} {
  const match = content.match(NOTION_PROPERTIES_TABLE);
  if (!match) return { properties: {}, cleanedContent: content };

  const properties: Record<string, string> = {};
  const rows = match[1].trim().split('\n');
  for (const row of rows) {
    const cells = row
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length >= 2) {
      properties[cells[0]] = cells[1];
    }
  }

  const cleanedContent = content.replace(match[0], '').trim();
  return { properties, cleanedContent };
}

export function cleanNotionMarkdown(content: string): {
  markdown: string;
  extractedProperties: Record<string, string>;
} {
  const { properties, cleanedContent } = extractNotionProperties(content);

  let markdown = cleanedContent;

  // Replace Notion internal links with plain text
  NOTION_UUID_LINK.lastIndex = 0;
  markdown = markdown.replace(NOTION_UUID_LINK, '$1');

  // Simplify breadcrumb headers (e.g., "# Workspace / Team / Page" -> "# Page")
  markdown = markdown.replace(/^(#{1,3})\s+(?:[^/\n]+\s*\/\s*)*([^/\n]+)$/gm, '$1 $2');

  return { markdown: markdown.trim(), extractedProperties: properties };
}
