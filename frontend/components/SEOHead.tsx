
import React, { useEffect } from 'react';
import { PropertyData } from '../types';

interface SEOHeadProps {
  data: PropertyData | null;
}

const upsertMeta = (
  selector: string,
  attribute: 'name' | 'property',
  key: string,
  content: string,
) => {
  let meta = document.head.querySelector<HTMLMetaElement>(selector);
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attribute, key);
    document.head.appendChild(meta);
  }
  meta.setAttribute('content', content);
};

const upsertLink = (rel: string, href: string) => {
  let link = document.head.querySelector<HTMLLinkElement>(`link[rel='${rel}']`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
};

const toAbsoluteUrl = (value?: string): string | null => {
  if (!value) return null;
  try {
    return new URL(value, window.location.origin).toString();
  } catch {
    return null;
  }
};

const SEOHead: React.FC<SEOHeadProps> = ({ data }) => {
  useEffect(() => {
    if (!data) return;

    const title = (data.metaTitle || data.name || 'SachiHouse').trim();
    const description = (data.description || data.subtitle || 'SachiHouse Tokyo stay information.').trim();
    const pageUrl = toAbsoluteUrl(window.location.href) || window.location.href;
    const imageUrl =
      toAbsoluteUrl(data.social?.footerImageUrl) ||
      toAbsoluteUrl(data.hostImageUrl) ||
      toAbsoluteUrl(data.metaFavicon) ||
      'https://cdn-icons-png.flaticon.com/512/2111/2111320.png';

    document.title = title;
    upsertMeta("meta[name='description']", 'name', 'description', description);

    upsertMeta("meta[property='og:title']", 'property', 'og:title', title);
    upsertMeta("meta[property='og:description']", 'property', 'og:description', description);
    upsertMeta("meta[property='og:type']", 'property', 'og:type', 'website');
    upsertMeta("meta[property='og:url']", 'property', 'og:url', pageUrl);
    upsertMeta("meta[property='og:image']", 'property', 'og:image', imageUrl);

    upsertMeta("meta[name='twitter:card']", 'name', 'twitter:card', 'summary_large_image');
    upsertMeta("meta[name='twitter:title']", 'name', 'twitter:title', title);
    upsertMeta("meta[name='twitter:description']", 'name', 'twitter:description', description);
    upsertMeta("meta[name='twitter:image']", 'name', 'twitter:image', imageUrl);

    upsertLink('canonical', pageUrl);
  }, [data]);

  return null; // This component doesn't render visual UI
};

export default SEOHead;
