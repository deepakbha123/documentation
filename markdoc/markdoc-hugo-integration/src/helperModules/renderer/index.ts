import MarkdownIt from 'markdown-it';
import type {
  ClientVariable,
  RenderableTreeNodes,
  Config as MarkdocConfig
} from 'markdoc-static-compiler';
import { HugoConfig } from '../../schemas/config/hugo';
const { escapeHtml } = MarkdownIt().utils;
import { reresolve } from './reresolver';
import { isTag, isClientVariable, isClientFunction } from './utils';
import { CustomHtmlComponent } from './CustomHtmlComponent';

// HTML elements that do not have a matching close tag
// Defined in the HTML standard: https://html.spec.whatwg.org/#void-elements
const voidElements = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);

/**
 * A custom rendering function that takes a tree of nodes
 * and renders them into a string of HTML.
 *
 * Markdoc includes a HTML renderer and React renderer OOTB,
 * but we require a custom renderer because our version of the
 * rendering tree contains extra information about when
 * to display certain nodes, and we render this extra information
 * into the HTML as proprietary HTML attributes, so these conditions
 * can be re-evaluated as needed on the client side.
 *
 * In OOTB Markdoc, this idea of conditionality
 * does not exist at the rendering step -- the conditionality is
 * resolved earlier and the rendering tree only contains the nodes
 * that should be displayed.
 *
 * Read more about Markdoc's rendering step:
 * https://markdoc.dev/docs/render#render
 */
function render(p: {
  node: RenderableTreeNodes;
  markdocConfig?: MarkdocConfig;
  hugoConfig: HugoConfig;
  components?: Record<string, any>;
}): string {
  // If this is plain text content, escape and return it
  if (typeof p.node === 'string' || typeof p.node === 'number')
    return escapeHtml(String(p.node));

  // If there's no content available to render in this data,
  // return an empty string
  if (p.node === null || typeof p.node !== 'object') {
    return '';
  }

  // If this is an array of nodes, render the list recursively
  // and join the results together into one HTML string
  if (Array.isArray(p.node))
    return p.node
      .map((n) => {
        return render({ ...p, node: n });
      })
      .join('');

  // If this node represents a variable, render the variable's value
  if (isClientVariable(p.node)) {
    if (p.markdocConfig && p.markdocConfig.variables !== undefined) {
      // TODO: Fix reresolve return type so recasting isn't necessary
      p.node = reresolve(p.node, p.markdocConfig) as ClientVariable;
    }
    return escapeHtml(String(p.node.value));
  }

  // If this node represents a function, resolve the function's
  // value for use by other nodes, but don't render anything now
  if (isClientFunction(p.node)) {
    if (p.markdocConfig && p.markdocConfig.variables !== undefined) {
      p.node = reresolve(p.node, p.markdocConfig);
    }
    return '';
  }

  // Handle non-tag nodes (such as code fences)
  if (p.node.$$mdtype === 'Node') {
    const nodeType = p.node.type as string;
    // If this node is a custom component, render it
    // using its dedicated class as defined in the components arg
    if (
      nodeType &&
      typeof nodeType === 'string' &&
      p.components &&
      nodeType in p.components
    ) {
      const Klass = p.components[nodeType];
      return new Klass(p.node, p.markdocConfig, p.components).render();
    }
  }

  // If this node has no content, return an empty string
  if (!isTag(p.node)) {
    return '';
  }

  const { name, attributes, children = [] } = p.node;

  // If this tag is a custom component, render it
  // using its dedicated class as defined in the components arg
  if (p.components && name in p.components) {
    const Klass = p.components[name];
    return new Klass({
      tag: p.node,
      markdocConfig: p.markdocConfig,
      components: p.components,
      hugoConfig: p.hugoConfig
    }).render();
  }

  // If this tag is an `if` tag, it should function as
  // a conditional display wrapper. Render it as a div
  // with a display class that can be toggled off and on
  // by the client side JavaScript.
  if ('if' in p.node && p.node.if) {
    let ref = '';
    if ('ref' in p.node.if) {
      ref = `data-if=${p.node.if.ref}`;
    }
    if (p.markdocConfig && p.markdocConfig.variables !== undefined) {
      p.node = reresolve(p.node, p.markdocConfig); // TODO: Fix with generic type
    }
    let wrapperTagClasses = 'mdoc__toggleable';
    if (attributes?.display === 'false') {
      wrapperTagClasses += ` mdoc__hidden`;
    }
    let wrapperTagOutput = `<${name} class="${wrapperTagClasses}" ${ref}>`;
    wrapperTagOutput += render({ ...p, node: children });
    wrapperTagOutput += `</${name}>`;
    return wrapperTagOutput;
  }

  // If the tag has no name, just render its children
  if (!name) {
    return render({
      node: children,
      markdocConfig: p.markdocConfig,
      hugoConfig: p.hugoConfig
    });
  }

  // If this is a standard HTML tag, convert it HTML markup
  // and return that
  let output = `<${name}`;
  for (const [k, v] of Object.entries(attributes ?? {}))
    output += ` ${k.toLowerCase()}="${escapeHtml(String(v))}"`;
  output += '>';

  if (voidElements.has(name)) return output;

  if (children.length)
    output += render({
      node: children,
      markdocConfig: p.markdocConfig,
      components: p.components,
      hugoConfig: p.hugoConfig
    });
  output += `</${name}>`;

  return output;
}

export { render, CustomHtmlComponent };
