import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Loader2 } from 'lucide-react';
import { BlogPost, blogService } from '../services/blogService';
import { useLanguage } from '../contexts/LanguageContext';

export const BlogSidebar: React.FC = () => {
  const { t } = useLanguage();
  const [recentPosts, setRecentPosts] = useState<BlogPost[]>([]);
  const [categories, setCategories] = useState<{name: string, count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '');

  useEffect(() => {
    blogService.getPosts().then(data => {
      setRecentPosts(data.slice(0, 4));
      
      const counts: Record<string, number> = {};
      data.forEach(p => {
        if (p.category) {
          counts[p.category] = (counts[p.category] || 0) + 1;
        }
      });
      const catsArray = Object.entries(counts).map(([name, count]) => ({name, count}));
      catsArray.sort((a, b) => b.count - a.count);
      setCategories(catsArray);
      
      setLoading(false);
    });
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchTerm.trim()) {
      navigate(`/blog?q=${encodeURIComponent(searchTerm.trim())}`);
    } else {
      navigate(`/blog`);
    }
  };

  return (
    <div className="w-full lg:w-[340px] flex-shrink-0 space-y-6">
      {/* Search */}
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e2e3] p-6 shadow-sm">
        <h3 className="font-['Plus_Jakarta_Sans'] font-bold text-[18px] text-[#1b1c1d] mb-4">{t('blog_sidebar_search')}</h3>
        <form className="relative" onSubmit={handleSearch}>
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t('blog_sidebar_search_placeholder')}
            className="w-full bg-[#f5f3f4] border border-[#e4e2e3] rounded-lg pl-4 pr-10 py-3 text-[14px] text-[#1b1c1d] focus:outline-none focus:ring-1 focus:ring-[#041627] transition-colors"
          />
          <button type="submit" className="absolute right-3 top-1/2 -translate-y-1/2 text-[#74777d] hover:text-[#1b1c1d]">
            <Search className="w-5 h-5" />
          </button>
        </form>
      </div>

      {/* Categories */}
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e2e3] p-6 shadow-sm">
        <h3 className="font-['Plus_Jakarta_Sans'] font-bold text-[18px] text-[#1b1c1d] mb-4">{t('blog_sidebar_categories')}</h3>
        {loading ? (
            <div className="flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : categories.length === 0 ? (
            <div className="text-sm text-gray-500">{t('blog_sidebar_no_categories')}</div>
        ) : (
            <div className="space-y-3">
            {categories.map((cat, idx) => (
                <Link key={idx} to={`/blog?category=${encodeURIComponent(cat.name)}`} className="flex justify-between items-center group cursor-pointer">
                <span className="text-[#44474c] text-[14px] font-medium group-hover:text-[#1b1c1d] transition-colors">{cat.name}</span>
                <span className="bg-[#f5f3f4] text-[#74777d] text-[12px] font-semibold px-2 py-0.5 rounded group-hover:bg-[#e4e2e3] group-hover:text-[#1b1c1d] transition-colors">{cat.count}</span>
                </Link>
            ))}
            </div>
        )}
      </div>

      {/* Recent Posts */}
      <div className="bg-[#ffffff] rounded-2xl border border-[#e4e2e3] p-6 shadow-sm">
        <h3 className="font-['Plus_Jakarta_Sans'] font-bold text-[18px] text-[#1b1c1d] mb-4">{t('blog_sidebar_recent_posts')}</h3>
        {loading ? (
            <div className="flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : recentPosts.length === 0 ? (
            <div className="text-sm text-gray-500">{t('blog_sidebar_no_recent')}</div>
        ) : (
            <div className="space-y-6">
            {recentPosts.map(post => (
                <Link key={post.id} to={`/blog/${post.id}`} className="flex gap-4 group">
                <div className="w-20 h-20 rounded-xl bg-[#efedef] overflow-hidden flex-shrink-0">
                    {post.imageUrl ? (
                    <img src={post.imageUrl} alt={post.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                    <div className="w-full h-full border border-dashed border-[#c4c6cd]"></div>
                    )}
                </div>
                <div className="flex flex-col justify-center">
                    <h4 className="font-['Plus_Jakarta_Sans'] font-bold text-[14px]/[1.4] text-[#44474c] mb-1.5 group-hover:text-[#1b1c1d] transition-colors line-clamp-2">{post.title}</h4>
                    <span className="text-[#74777d] text-[12px] font-semibold">{new Date(post.createdAt).toLocaleDateString()}</span>
                </div>
                </Link>
            ))}
            </div>
        )}
      </div>
    </div>
  );
};
