import React, { useEffect, useState, useMemo } from 'react';
import { GlobalLayout } from '../components/GlobalLayout';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Loader2 } from 'lucide-react';
import { BlogSidebar } from '../components/BlogSidebar';
import { BlogPost, blogService } from '../services/blogService';
import { Helmet } from 'react-helmet-async';
import { useLanguage } from '../contexts/LanguageContext';

const BlogPage: React.FC = () => {
  const { t } = useLanguage();
  const [allPosts, setAllPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isMobileFiltersOpen, setIsMobileFiltersOpen] = useState(false);
  const [draftCategory, setDraftCategory] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryFilter = searchParams.get('category');
  const searchFilter = searchParams.get('q');

  const categoryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    allPosts.forEach((post) => {
      if (!post.category) {
        return;
      }
      counts.set(post.category, (counts.get(post.category) || 0) + 1);
    });
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
  }, [allPosts]);

  const updateCategoryFilter = (nextCategory: string) => {
    const next = new URLSearchParams(searchParams);
    if (nextCategory) {
      next.set('category', nextCategory);
    } else {
      next.delete('category');
    }
    setSearchParams(next, { replace: true });
  };

  const applyDraftCategoryFilter = () => {
    updateCategoryFilter(draftCategory);
    setIsMobileFiltersOpen(false);
  };

  const clearMobileCategoryFilter = () => {
    setDraftCategory('');
    updateCategoryFilter('');
    setIsMobileFiltersOpen(false);
  };

  useEffect(() => {
    setDraftCategory(categoryFilter || '');
  }, [categoryFilter]);

  useEffect(() => {
    let cancelled = false;

    const loadPosts = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const data = await blogService.getPosts();
        if (cancelled) {
          return;
        }
        setAllPosts(data);
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error('Failed to load blog posts', error);
        setLoadError(t('blog_load_error'));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadPosts();

    return () => {
      cancelled = true;
    };
  }, []);

  const posts = useMemo(() => {
    let filtered = allPosts;
    if (categoryFilter) {
      filtered = filtered.filter(p => p.category === categoryFilter);
    }
    if (searchFilter) {
      const q = searchFilter.toLowerCase();
      filtered = filtered.filter(p => 
        p.title.toLowerCase().includes(q) || 
        p.excerpt.toLowerCase().includes(q) || 
        p.content.toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [allPosts, categoryFilter, searchFilter]);

  const featuredPost = (categoryFilter || searchFilter) ? null : (posts.find(p => p.isFeatured) || posts[0]);
  const regularPosts = posts.filter(p => p.id !== featuredPost?.id);

  if (loading) {
    return (
      <GlobalLayout>
        <div className="flex flex-col justify-center items-center py-20 gap-3 text-[#041627]">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm font-medium tracking-[0.04em] uppercase">{t('loading')}</p>
        </div>
      </GlobalLayout>
    );
  }

  if (loadError) {
    return (
      <GlobalLayout>
        <div className="min-h-[40vh] flex items-center justify-center px-6 text-center text-[#ba1a1a]">
          {loadError}
        </div>
      </GlobalLayout>
    );
  }

  const pageTitle = categoryFilter
    ? `${t('blog_category_prefix')} ${categoryFilter} | Tokyo Travel Blog`
    : searchFilter
    ? `${t('blog_search_prefix')} ${searchFilter} | Tokyo Travel Blog`
    : `${t('blog_title_default')} | The Ultimate Guide`;

  const pageDescription = t('blog_subtitle_default');

  return (
    <GlobalLayout>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        <meta property="og:type" content="website" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
      </Helmet>
      
      <div className="flex flex-col mb-8 md:mb-10 gap-2 text-center md:text-left">
        <h1 className="font-['Plus_Jakarta_Sans'] text-[24px] md:text-[36px] font-bold text-[#1b1c1d] leading-[1.2]">
          {categoryFilter ? `${t('blog_category_prefix')} ${categoryFilter}` : searchFilter ? `${t('blog_search_prefix')} ${searchFilter}` : t('blog_title_default')}
        </h1>
        {(categoryFilter || searchFilter) ? (
          <p className="text-[14px] md:text-[16px] text-[#44474c] leading-[1.6]">
            {t('blog_showing_posts_for').replace('{query}', categoryFilter || searchFilter || '')} <Link to="/blog" className="text-blue-600 hover:underline">{t('blog_clear_filter')}</Link>
          </p>
        ) : (
          <p className="hidden md:block text-[16px] text-[#44474c] leading-[1.6]">
            {t('blog_subtitle_default')}
          </p>
        )}
      </div>

      <div className="mb-5 md:hidden">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsMobileFiltersOpen((prev) => !prev)}
            className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-[#c4c6cd] bg-white px-4 py-3 text-left text-[14px] font-semibold text-[#1b1c1d]"
          >
            <span>
              {t('blog_filters')}
              {categoryFilter ? ' (1)' : ''}
            </span>
            {isMobileFiltersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={clearMobileCategoryFilter}
            className="shrink-0 rounded-xl border border-[#c4c6cd] bg-white px-3 py-3 text-[13px] font-semibold text-[#44474c] transition-colors hover:bg-[#efedef]"
          >
            {t('blog_clear_filter')}
          </button>
        </div>

        {isMobileFiltersOpen && (
          <div className="mt-3 grid grid-cols-1 gap-3 rounded-xl border border-[#e4e2e3] bg-white p-3">
            <div>
              <label htmlFor="mobile-blog-category" className="mb-1 block text-[12px] font-semibold uppercase tracking-[0.08em] text-[#74777d]">
                {t('blog_category_label')}
              </label>
              <select
                id="mobile-blog-category"
                value={draftCategory}
                onChange={(event) => setDraftCategory(event.target.value)}
                className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-[14px] text-[#1b1c1d] focus:outline-none focus:border-[#041627] focus:ring-1 focus:ring-[#041627]"
              >
                <option value="">{t('blog_all_categories')}</option>
                {categoryOptions.map((category) => (
                  <option key={category.name} value={category.name}>{category.name}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={applyDraftCategoryFilter}
              className="rounded-lg bg-[#041627] px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#041627]/90"
            >
              {t('blog_apply_filter')}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* Main Content Area */}
        <div className="flex-1 w-full space-y-0 md:space-y-6">
          {featuredPost && (
            <div className="bg-[#ffffff] md:rounded-2xl border-b border-[#e4e2e3] md:border overflow-hidden md:shadow-sm hover:shadow-md transition-shadow group relative -mx-3 md:mx-0">
              <Link to={`/blog/${featuredPost.id}`} className="flex flex-row md:block h-full cursor-pointer p-4 md:p-0">
                <div className="relative w-[112px] h-[88px] shrink-0 md:w-full md:h-auto md:aspect-[21/9] overflow-hidden bg-[#efedef]">
                  {featuredPost.imageUrl ? (
                    <img 
                      src={featuredPost.imageUrl} 
                      alt={featuredPost.title} 
                      className="absolute md:relative inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                    />
                  ) : (
                    <div className="absolute md:relative inset-0 w-full h-full flex justify-center items-center">
                      <span className="text-[#c4c6cd]">{t('blog_no_image')}</span>
                    </div>
                  )}
                  {featuredPost.category && (
                    <div className="hidden md:block absolute top-4 left-4 bg-[#ffffff] px-4 py-1.5 rounded-full text-[12px] font-bold text-[#1b1c1d] shadow-sm">
                      {featuredPost.category}
                    </div>
                  )}
                </div>
                <div className="pl-4 py-1 pr-0 md:p-8 flex flex-col justify-center">
                  <h2 className="font-['Plus_Jakarta_Sans'] text-[16px] md:text-[28px] font-bold text-[#1b1c1d] mb-1 md:mb-4 group-hover:text-blue-600 transition-colors line-clamp-2 md:line-clamp-none">{featuredPost.title}</h2>
                  <p className="text-[#44474c] text-[14px] md:text-[16px] leading-[1.5] mb-0 md:mb-6 line-clamp-2 md:line-clamp-none">{featuredPost.excerpt}</p>
                  <div className="hidden md:flex items-center text-[12px] font-semibold text-[#74777d]">
                    <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    {new Date(featuredPost.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </Link>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-6 -mx-3 md:mx-0">
            {regularPosts.map(post => (
              <div key={post.id} className="bg-[#ffffff] md:rounded-2xl border-b border-[#e4e2e3] md:border overflow-hidden md:shadow-sm hover:shadow-md transition-shadow flex flex-col h-full group relative">
                <Link to={`/blog/${post.id}`} className="flex flex-row md:flex-col flex-grow cursor-pointer relative p-4 md:p-0">
                  <div className="relative w-[112px] h-[88px] shrink-0 md:w-full md:h-auto md:aspect-[4/3] overflow-hidden bg-[#efedef]">
                    {post.imageUrl ? (
                      <img 
                        src={post.imageUrl} 
                        alt={post.title} 
                        className="absolute md:relative inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" 
                      />
                    ) : (
                      <div className="absolute md:relative inset-0 w-full h-full flex justify-center items-center">
                        <span className="text-[#c4c6cd]">{t('blog_no_image')}</span>
                      </div>
                    )}
                    {post.category && (
                      <div className="hidden md:block absolute top-4 left-4 bg-[#ffffff] px-3 py-1 rounded-full text-[12px] font-bold text-[#1b1c1d] shadow-sm">
                        {post.category}
                      </div>
                    )}
                  </div>
                  <div className="pl-4 py-1 pr-0 md:p-6 flex flex-col flex-grow justify-center">
                    <h2 className="font-['Plus_Jakarta_Sans'] font-bold text-[16px] md:text-[18px]/[1.4] text-[#1b1c1d] mb-1 md:mb-3 group-hover:text-blue-600 transition-colors line-clamp-2">{post.title}</h2>
                    <p className="text-[14px] md:text-[14px]/[1.6] text-[#44474c] line-clamp-2 md:line-clamp-3 mb-0 md:mb-6">{post.excerpt}</p>
                    
                    <div className="mt-auto hidden md:flex items-center text-[12px] font-semibold text-[#74777d]">
                      <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      {new Date(post.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                </Link>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex justify-center items-center py-10 gap-2">
            <button className="w-10 h-10 rounded-full border border-[#e4e2e3] flex items-center justify-center text-[#44474c] hover:bg-[#e4e2e3] disabled:opacity-50" disabled>
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button className="w-10 h-10 rounded-full bg-[#041627] text-white font-semibold text-[14px] flex items-center justify-center">1</button>
            {/* <button className="w-10 h-10 rounded-full border border-[#e4e2e3] text-[#44474c] hover:bg-[#e4e2e3] font-semibold text-[14px] flex items-center justify-center">2</button>
            <button className="w-10 h-10 rounded-full border border-[#e4e2e3] flex items-center justify-center text-[#44474c] hover:bg-[#e4e2e3]">
              <ChevronRight className="w-5 h-5" />
            </button> */}
          </div>
        </div>

        {/* Sidebar */}
        <div className="hidden lg:block">
          <BlogSidebar />
        </div>
      </div>
    </GlobalLayout>
  );
};

export default BlogPage;
