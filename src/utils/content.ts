export interface InstagramBlock { content: string; startLine: number; }

export function withoutFrontmatter(source: string): string {
	const match = source.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/);
	if (!match) return source;
	const inner = match[0].split(/\r?\n/).slice(1, -1);
	const looksLikeYaml = inner.some((line) => /^[\w"'][^:]*:\s*/.test(line));
	return looksLikeYaml ? source.slice(match[0].length) : source;
}

export function extractInstagramBlocks(source: string): InstagramBlock[] {
	const lines = withoutFrontmatter(source).split(/\r?\n/);
	const blocks: InstagramBlock[] = [];
	let start = 0;
	for (let index = 0; index < lines.length; index += 1) {
		if (!isSlideSeparator(lines, index)) continue;
		const content = lines.slice(start, index).join('\n').trim();
		if (content) blocks.push({ content, startLine: start + 1 });
		start = index + 1;
	}
	const finalContent = lines.slice(start).join('\n').trim();
	if (finalContent) blocks.push({ content: finalContent, startLine: start + 1 });
	return blocks;
}

function isSlideSeparator(lines: string[], index: number): boolean {
	if (!/^\s*---\s*$/.test(lines[index] ?? '')) return false;
	const beforeIsBlank = index === 0 || (lines[index - 1] ?? '').trim() === '';
	const afterIsBlank = index === lines.length - 1 || (lines[index + 1] ?? '').trim() === '';
	return beforeIsBlank && afterIsBlank;
}

function splitWithBudget(text: string, budget: number): string[] {
	const tokens = text.trim().match(/\S+|\s+/g) ?? [];
	const result: string[] = [];
	let current = '';
	for (const token of tokens) {
		if (current && (current + token).trimEnd().length > budget) {
			result.push(current.trim());
			current = token.trimStart();
		} else current += token;
	}
	if (current.trim()) result.push(current.trim());
	return result;
}

export function createBlueskyThread(source: string, maxLength = 300, separator = '/'): string[] {
	const body = extractInstagramBlocks(source).map((block) => block.content).join('\n\n').trim();
	if (!body) return [];
	let expectedCount = 1;
	let fragments: string[] = [];
	for (let pass = 0; pass < 10; pass += 1) {
		const suffixLength = ` ${separator}${expectedCount}`.length;
		fragments = splitWithBudget(body, maxLength - suffixLength);
		if (fragments.length === expectedCount) break;
		expectedCount = fragments.length;
	}
	return fragments.map((fragment, index) => `${fragment} ${separator}${index + 1}`);
}
