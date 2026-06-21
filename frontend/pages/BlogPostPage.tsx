import React, { useEffect, useState } from 'react';
import { GlobalLayout } from '../components/GlobalLayout';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import { ChevronLeft, Loader2, Edit2 } from 'lucide-react';
import { BlogSidebar } from '../components/BlogSidebar';
import { BlogPost, blogService } from '../services/blogService';
import { Helmet } from 'react-helmet-async';
import { checkAuth, subscribeToAuth } from '../services/auth';
import { useLanguage } from '../contexts/LanguageContext';
import './blog-post.css';

const BlogPostPage: React.FC = () => {
  const { t } = useLanguage();
  const { id } = useParams<{ id: string }>();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean>(checkAuth());
  const navigate = useNavigate();

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setIsAdmin(!!user);
    }).then((callback) => {
      unsubscribe = callback;
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (id) {
      setLoading(true);
      blogService.getPostById(id).then(data => {
        setPost(data);
        setLoading(false);
      });
    }
  }, [id]);

  if (loading) {
    return (
      <GlobalLayout>
        <div className="flex justify-center items-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
        </div>
      </GlobalLayout>
    );
  }

  if (!post) {
    return (
      <GlobalLayout>
        <div className="py-20 text-center">
          <h2 className="text-2xl font-bold mb-4 text-[#1b1c1d]">{t('blog_post_not_found')}</h2>
          <Link to="/blog" className="text-blue-600 hover:underline">{t('blog_return_to_blog')}</Link>
        </div>
      </GlobalLayout>
    );
  }

  const pageTitle = `${post.title} | Tokyo Travel Blog`;
  const pageDescription = post.excerpt || `Read about ${post.title} on our Tokyo Travel Blog.`;
  const imageUrl = post.imageUrl || ''; // You could also set a default image
  const contentFormat = post.contentFormat || 'markdown';

  return (
    <GlobalLayout>
      <Helmet>
        <title>{pageTitle}</title>
        <meta name="description" content={pageDescription} />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={pageDescription} />
        {imageUrl && <meta property="og:image" content={imageUrl} />}
        <meta property="og:type" content="article" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={pageTitle} />
        <meta name="twitter:description" content={pageDescription} />
        {imageUrl && <meta name="twitter:image" content={imageUrl} />}
      </Helmet>
      <div className="bg-white -mx-3 md:mx-0 md:rounded-2xl md:border md:border-[#e4e2e3] px-4 py-5 md:p-8 lg:p-10 border-t border-b border-[#e4e2e3]">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-6 gap-3">
          <Link to="/blog" className="inline-flex items-center text-[#44474c] hover:text-[#1b1c1d] font-semibold text-[15px] transition-colors w-fit">
            <ChevronLeft className="w-5 h-5 mr-1" />
            {t('blog_back_to_blog')}
          </Link>
          {isAdmin && (
            <button 
              onClick={() => navigate(`/blog/admin?edit=${post.id}`)}
              className="inline-flex items-center bg-[#f5f3f4] border border-[#e4e2e3] text-[#1b1c1d] px-4 py-2.5 rounded-full font-semibold text-[14px]/[1.4] hover:bg-[#e4e2e3] transition-colors shadow-sm w-fit"
            >
              <Edit2 className="w-4 h-4 mr-1.5" /> {t('blog_edit_post')}
            </button>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Main Content Area */}
          <div className="flex-1 w-full max-w-[900px]">
            <div className="mb-5 text-left">
              <div className="flex items-center gap-2 mb-3 justify-start flex-wrap">
                 {post.category && <span className="bg-[#f5f3f4] text-[#1b1c1d] px-2.5 py-1 rounded text-[11px] font-bold inline-block w-max uppercase tracking-wide">{post.category}</span>}
                 <span className="text-[#74777d] text-[12px] font-medium flex items-center justify-start">
                   <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                   </svg>
                   {new Date(post.createdAt).toLocaleDateString()}
                 </span>
              </div>
              <h1 className="font-['Plus_Jakarta_Sans'] text-[20px] md:text-[28px] font-bold text-[#1b1c1d] leading-[1.3] tracking-[-0.01em] text-left">{post.title}</h1>
            </div>

            {post.imageUrl ? (
              <div className="w-full aspect-[16/9] md:aspect-[2.5/1] overflow-hidden rounded-xl mb-6 shadow-sm border border-[#e4e2e3]">
                <img 
                  src={post.imageUrl} 
                  alt={post.title} 
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-full aspect-[16/9] md:aspect-[2.5/1] bg-[#efedef] rounded-xl mb-6 shadow-sm border border-[#e4e2e3] flex items-center justify-center">
                <span className="text-[#c4c6cd] font-semibold text-[15px]">{t('blog_no_image')}</span>
              </div>
            )}

            <div className="article-markdown max-w-none">
              {contentFormat === 'markdown' ? (
                <Markdown>{post.content}</Markdown>
              ) : (
                <div dangerouslySetInnerHTML={{ __html: post.content }} />
              )}
            </div>
          </div>

          {/* Sidebar */}
          <BlogSidebar />
        </div>
      </div>
    </GlobalLayout>
  );
};

export default BlogPostPage;
