import React, { useEffect, useState } from 'react';
import { GlobalLayout } from '../components/GlobalLayout';
import { useParams, Link, useNavigate } from 'react-router-dom';
import Markdown from 'react-markdown';
import { ChevronLeft, Loader2, Edit2 } from 'lucide-react';
import { BlogSidebar } from '../components/BlogSidebar';
import { BlogPost, blogService } from '../services/blogService';
import { Helmet } from 'react-helmet-async';
import { checkAuth, subscribeToAuth } from '../services/auth';
import './blog-post.css';

const BlogPostPage: React.FC = () => {
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
          <h2 className="text-2xl font-bold mb-4 text-[#1b1c1d]">Post not found</h2>
          <Link to="/blog" className="text-blue-600 hover:underline">Return to Blog</Link>
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
      <div className="bg-white rounded-2xl border border-[#e4e2e3] p-4 md:p-8 lg:p-10">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center mb-10 gap-4">
          <Link to="/blog" className="inline-flex items-center text-[#44474c] hover:text-[#1b1c1d] font-semibold text-[15px] transition-colors w-fit">
            <ChevronLeft className="w-5 h-5 mr-1" />
            Back to Blog
          </Link>
          {isAdmin && (
            <button 
              onClick={() => navigate(`/blog/admin?edit=${post.id}`)}
              className="inline-flex items-center bg-[#f5f3f4] border border-[#e4e2e3] text-[#1b1c1d] px-4 py-2.5 rounded-full font-semibold text-[14px]/[1.4] hover:bg-[#e4e2e3] transition-colors shadow-sm w-fit"
            >
              <Edit2 className="w-4 h-4 mr-1.5" /> Edit Post
            </button>
          )}
        </div>

        <div className="flex flex-col lg:flex-row gap-8 items-start">
          {/* Main Content Area */}
          <div className="flex-1 w-full max-w-[900px]">
            <div className="mb-10 text-left">
              <div className="flex items-center gap-3 mb-6 justify-start">
                 {post.category && <span className="bg-[#f5f3f4] text-[#1b1c1d] px-3.5 py-1.5 rounded-full text-[13px] font-bold inline-block w-max mx-0">{post.category}</span>}
                 <span className="text-[#74777d] text-[14px] font-semibold flex items-center justify-start">
                   <svg className="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                     <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                   </svg>
                   {new Date(post.createdAt).toLocaleDateString()}
                 </span>
              </div>
              <h1 className="font-['Plus_Jakarta_Sans'] text-[24px] md:text-[34px] font-bold text-[#1b1c1d] leading-[1.15] tracking-[-0.02em] text-left">{post.title}</h1>
            </div>

            {post.imageUrl ? (
              <div className="w-full aspect-[21/9] md:aspect-[2.5/1] overflow-hidden rounded-2xl mb-12 shadow-sm border border-[#e4e2e3]">
                <img 
                  src={post.imageUrl} 
                  alt={post.title} 
                  className="w-full h-full object-cover"
                />
              </div>
            ) : (
              <div className="w-full aspect-[21/9] md:aspect-[2.5/1] bg-[#efedef] rounded-2xl mb-12 shadow-sm border border-[#e4e2e3] flex items-center justify-center">
                <span className="text-[#c4c6cd] font-semibold text-[15px]">No image</span>
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
