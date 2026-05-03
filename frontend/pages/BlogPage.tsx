import React, { useEffect, useState, useMemo } from 'react';
import { GlobalLayout } from '../components/GlobalLayout';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { BlogSidebar } from '../components/BlogSidebar';
import { BlogPost, blogService } from '../services/blogService';
import { Helmet } from 'react-helmet-async';

const BlogPage: React.FC = () => {
  const [allPosts, setAllPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const categoryFilter = searchParams.get('category');
  const searchFilter = searchParams.get('q');

  useEffect(() => {
    blogService.getPosts().then(data => {
      setAllPosts(data);
      setLoading(false);
    });
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
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </GlobalLayout>
    );
  }

  const pageTitle = categoryFilter 
    ? `Category: ${categoryFilter} | Tokyo Travel Blog` 
    : searchFilter
    ? `Search: ${searchFilter} | Tokyo Travel Blog`
    : 'Tokyo Travel Stories & Tips | The Ultimate Guide';
  
  const pageDescription = "Discover hidden gems, navigate the bustling streets, and immerse yourself in the culture of Japan's vibrant capital. Curated insights for the modern traveler.";

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
          {categoryFilter ? `Category: ${categoryFilter}` : searchFilter ? `Search: ${searchFilter}` : 'Tokyo Travel Stories & Tips'}
        </h1>
        {(categoryFilter || searchFilter) ? (
          <p className="text-[14px] md:text-[16px] text-[#44474c] leading-[1.6]">
            Showing posts for "{categoryFilter || searchFilter}". <Link to="/blog" className="text-blue-600 hover:underline">Clear filter</Link>
          </p>
        ) : (
          <p className="hidden md:block text-[16px] text-[#44474c] leading-[1.6]">
            Discover hidden gems, navigate the bustling streets, and immerse yourself in the culture<br className="hidden md:block"/>of Japan's vibrant capital. Curated insights for the modern traveler.
          </p>
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
                      <span className="text-[#c4c6cd]">No image</span>
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
                        <span className="text-[#c4c6cd]">No image</span>
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
        <BlogSidebar />
      </div>
    </GlobalLayout>
  );
};

export default BlogPage;
