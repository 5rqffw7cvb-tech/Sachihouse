
import React from 'react';
import { PropertyData } from '../types';
import { Seo } from './Seo';

interface SEOHeadProps {
  data: PropertyData | null;
  /** A property has several public sub-pages (access, pricing, rules...) that
   *  would otherwise all share the property's own title/description — this
   *  disambiguates each one so Search Console stops flagging them as
   *  duplicates of the property's home page. */
  titleSuffix?: string;
}

const SEOHead: React.FC<SEOHeadProps> = ({ data, titleSuffix }) => {
  if (!data) return null;

  const baseTitle = (data.metaTitle || data.name || 'SachiHouse').trim();
  const baseDescription = (data.description || data.subtitle || 'SachiHouse Tokyo stay information.').trim();
  const title = titleSuffix ? `${baseTitle} | ${titleSuffix}` : baseTitle;
  const description = titleSuffix ? `${titleSuffix} — ${baseDescription}` : baseDescription;

  return <Seo title={title} description={description} />;
};

export default SEOHead;
