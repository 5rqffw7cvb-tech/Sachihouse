
import React, { useEffect } from 'react';
import { PropertyData } from '../types';

interface SEOHeadProps {
  data: PropertyData | null;
}

const SEOHead: React.FC<SEOHeadProps> = ({ data }) => {
  useEffect(() => {
    if (!data) return;

    // 1. Update Document Title
    if (data.metaTitle) {
      document.title = data.metaTitle;
    } else if (data.name) {
      document.title = data.name;
    }
  }, [data]);

  return null; // This component doesn't render visual UI
};

export default SEOHead;
