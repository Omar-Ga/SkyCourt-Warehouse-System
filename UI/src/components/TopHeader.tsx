import React from 'react';
import { PageLayout, PageLayoutProps } from './PageLayout';

export const TopHeader: React.FC<PageLayoutProps> = (props) => {
  return <PageLayout {...props} />;
};

export default TopHeader;
