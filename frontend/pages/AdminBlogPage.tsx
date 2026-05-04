import React, { useState, useEffect, useRef } from 'react';
import { BlogPost, blogService } from '../services/blogService';
import { Plus, Edit2, Trash2, Lock, Loader2, ArrowLeft, Save, ImageIcon, Check, X, PencilLine, Columns2, Eye, Bold, Italic, List, ListOrdered, Heading2, Quote, Link as LinkIcon } from 'lucide-react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { MobileBottomNav } from '../components/MobileBottomNav';
import { TopNavBar } from '../components/TopNavBar';
import { ApiUser } from '../services/api';
import { getCurrentUser, subscribeToAuth } from '../services/auth';
import { DEFAULT_SITE_SETTINGS, getSiteSettings } from '../services/storage';
import { SiteSettings } from '../types';
import Markdown from 'react-markdown';

import { mockBlogPosts } from '../data/blogData';

const AdminBlogPage: React.FC = () => {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!getCurrentUser());
  const [authUser, setAuthUser] = useState<ApiUser | null>(getCurrentUser());
  const [errorMsg, setErrorMsg] = useState('');
  const [infoMsg, setInfoMsg] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [siteSettings, setSiteSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS);
  
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [editingPost, setEditingPost] = useState<Partial<BlogPost> | null>(null);
  const [editorView, setEditorView] = useState<'write' | 'split' | 'preview'>('split');
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const richTextRef = useRef<HTMLDivElement | null>(null);

  const canManageBlog = authUser?.role === 'ADMIN' || authUser?.role === 'HOST';

  const toSlug = (value: string) => value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');

  const contentFormat = editingPost?.contentFormat || 'markdown';

  const runRichTextCommand = (command: string, value?: string) => {
    if (!richTextRef.current) {
      return;
    }
    richTextRef.current.focus();
    document.execCommand(command, false, value);
    setEditingPost((prev) => prev ? { ...prev, content: richTextRef.current?.innerHTML || '' } : prev);
  };

  const fetchPosts = async () => {
    setErrorMsg('');
    setInfoMsg('');
    setLoading(true);
    try {
      const data = await blogService.getPosts();
      setPosts(data);

      const editId = searchParams.get('edit');
      if (editId) {
        const postToEdit = data.find((p) => p.id === editId);
        if (postToEdit) {
          setEditingPost({ ...postToEdit });
        }
        setSearchParams({}, { replace: true });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load blog posts.';
      setErrorMsg(message);
    } finally {
      setLoading(false);
    }
  };

  const handleSeed = async () => {
    setSeeding(true);
    setErrorMsg('');
    setInfoMsg('');
    try {
      for (const p of mockBlogPosts) {
        const { id, date, isFeatured, ...rest } = p;
        await blogService.createPost({
          ...rest,
          isFeatured: isFeatured || false,
        } as any, id);
      }
      await fetchPosts();
      setInfoMsg('Mock posts imported successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import mock posts.';
      setErrorMsg(message);
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    let unsubscribe = () => {};
    subscribeToAuth((user) => {
      setAuthUser(user);
      setIsAuthenticated(!!user);
    }).then((unsub) => {
      unsubscribe = unsub;
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    getSiteSettings()
      .then((settings) => setSiteSettings(settings))
      .catch(() => setSiteSettings(DEFAULT_SITE_SETTINGS));
  }, []);

  useEffect(() => {
    if (isAuthenticated && canManageBlog) {
      void fetchPosts();
      return;
    }
    setLoading(false);
  }, [isAuthenticated, canManageBlog]);

  const handleLogin = () => {
    setErrorMsg('');
    navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  const handleSave = async () => {
    if (!editingPost?.title || !editingPost?.content) {
      setErrorMsg('Title and content are required.');
      return;
    }
    
    setErrorMsg('');
    setInfoMsg('');
    setSaving(true);
    try {
      const safePostData = {
        title: editingPost.title || '',
        excerpt: editingPost.excerpt || '',
        content: editingPost.content || '',
        contentFormat: editingPost.contentFormat || 'markdown',
        imageUrl: editingPost.imageUrl || '',
        category: editingPost.category || '',
        isFeatured: editingPost.isFeatured || false,
      };

      if (editingPost.id) {
        await blogService.updatePost(editingPost.id, safePostData);
      } else {
        await blogService.createPost(safePostData);
      }
      setEditingPost(null);
      setInfoMsg('Post saved successfully.');
      await fetchPosts();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save post.';
      setErrorMsg(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setErrorMsg('');
    setInfoMsg('');
    try {
      await blogService.deletePost(id);
      setPosts((prev) => prev.filter((post) => post.id !== id));
      setConfirmDeleteId(null);
      setInfoMsg('Post deleted successfully.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete post.';
      setErrorMsg(message);
    }
  };

  const startEdit = (post: BlogPost) => {
    setEditingPost({ ...post });
    setEditorView('split');
  };

  const startNew = () => {
    setEditingPost({
      title: '',
      excerpt: '',
      content: '',
      contentFormat: 'markdown',
      imageUrl: '',
      category: 'Local Tips',
      isFeatured: false,
    });
    setEditorView('split');
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d]">
        <TopNavBar />
        <div className="min-h-[60vh] flex items-center justify-center px-4 pt-[110px] pb-12">
          <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200 w-full max-w-md">
            <div className="flex justify-center mb-6">
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                <Lock className="w-6 h-6" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-center text-gray-900 mb-3">Blog Admin Access</h2>
            <p className="text-sm text-[#44474c] text-center mb-6">Sign in with admin or host account to manage blog posts.</p>
            <div className="space-y-4">
              {errorMsg && <p className="text-red-500 text-sm text-center">{errorMsg}</p>}
              <button
                onClick={handleLogin}
                className="w-full bg-[#041627] hover:bg-[#041627]/90 text-white font-bold py-3 px-4 rounded-lg flex items-center justify-center gap-2"
              >
                Login
              </button>
            </div>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  if (!canManageBlog) {
    return (
      <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d]">
        <TopNavBar />
        <div className="max-w-3xl mx-auto px-4 pt-[110px] pb-12">
          <div className="bg-white border border-[#e4e2e3] rounded-2xl p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full bg-red-50 text-red-600 flex items-center justify-center">
              <Lock className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-bold text-[#1b1c1d] mb-2">Admin or host role required</h1>
            <p className="text-[#44474c] mb-6">Your current account does not have permission to access blog administration.</p>
            <Link to="/blog" className="inline-flex items-center px-5 py-2.5 rounded-full border border-[#041627] text-[#041627] font-semibold hover:bg-[#efedef] transition-colors">
              Back to blog
            </Link>
          </div>
        </div>
        <MobileBottomNav />
      </div>
    );
  }

  const draftTitle = editingPost?.title || '';
  const draftContent = editingPost?.content || '';
  const draftExcerpt = editingPost?.excerpt || '';
  const draftWordCount = draftContent.trim() ? draftContent.trim().split(/\s+/).length : 0;
  const estimatedReadMinutes = Math.max(1, Math.ceil(draftWordCount / 220));
  const draftSlug = toSlug(draftTitle || 'untitled-post');

  if (editingPost) {
    return (
      <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d] flex flex-col">
        <TopNavBar />
        <main className="flex-1 w-full max-w-[1280px] mx-auto px-3 md:px-6 pt-[110px] pb-28 md:pb-10">
          <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <button onClick={() => setEditingPost(null)} className="inline-flex items-center text-[#44474c] hover:text-[#1b1c1d] font-semibold">
              <ArrowLeft className="w-5 h-5 mr-2" /> Back to post list
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setEditorView('write')}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${editorView === 'write' ? 'border-[#041627] bg-[#041627] text-white' : 'border-[#c4c6cd] bg-white text-[#44474c] hover:bg-[#efedef]'}`}
              >
                <PencilLine className="h-3.5 w-3.5" /> Write
              </button>
              <button
                onClick={() => setEditorView('split')}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${editorView === 'split' ? 'border-[#041627] bg-[#041627] text-white' : 'border-[#c4c6cd] bg-white text-[#44474c] hover:bg-[#efedef]'}`}
              >
                <Columns2 className="h-3.5 w-3.5" /> Split
              </button>
              <button
                onClick={() => setEditorView('preview')}
                className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${editorView === 'preview' ? 'border-[#041627] bg-[#041627] text-white' : 'border-[#c4c6cd] bg-white text-[#44474c] hover:bg-[#efedef]'}`}
              >
                <Eye className="h-3.5 w-3.5" /> Preview
              </button>
            </div>
          </div>

          {errorMsg && (
            <div className="mb-6 border border-red-200 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
              {errorMsg}
            </div>
          )}

          {infoMsg && (
            <div className="mb-6 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">
              {infoMsg}
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <section className="space-y-5">
              <div className="rounded-2xl border border-[#e4e2e3] bg-white p-5 shadow-sm">
                <label className="mb-2 block text-sm font-bold text-[#44474c]">Post Title</label>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(e) => setEditingPost({ ...editingPost, title: e.target.value })}
                  className="w-full rounded-xl border border-[#c4c6cd] px-4 py-3 text-[20px] font-semibold text-[#1b1c1d] focus:border-[#041627] focus:outline-none focus:ring-1 focus:ring-[#041627]"
                  placeholder="Add title"
                />
                <p className="mt-2 text-xs text-[#74777d]">
                  Permalink: <span className="font-semibold text-[#1b1c1d]">/blog/{draftSlug}</span>
                </p>
              </div>

              <div className="rounded-2xl border border-[#e4e2e3] bg-white p-5 shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm font-bold text-[#041627]">Content</label>
                  <span className="text-xs text-[#74777d]">Words: {draftWordCount} · {estimatedReadMinutes} min read</span>
                </div>

                <div className="mb-3 w-full sm:w-56">
                  <label className="mb-1 block text-xs font-bold text-[#44474c]">Format</label>
                  <select
                    value={contentFormat}
                    onChange={(e) => {
                      const nextFormat = e.target.value as 'markdown' | 'rich_text' | 'html';
                      setEditingPost((prev) => {
                        if (!prev) {
                          return prev;
                        }
                        const normalizedContent = nextFormat === 'rich_text' && !(prev.content || '').trim()
                          ? '<p></p>'
                          : (prev.content || '');
                        return { ...prev, contentFormat: nextFormat, content: normalizedContent };
                      });
                    }}
                    className="w-full rounded-lg border border-[#c4c6cd] bg-white px-3 py-2 text-sm"
                  >
                    <option value="markdown">Markdown</option>
                    <option value="rich_text">Rich text</option>
                    <option value="html">HTML</option>
                  </select>
                </div>

                {(editorView === 'write' || editorView === 'split') && (
                  <>
                    {contentFormat === 'rich_text' ? (
                      <>
                        <div className="mb-2 flex flex-wrap gap-2 rounded-lg border border-[#e4e2e3] bg-[#f8f7f7] p-2">
                          <button type="button" onClick={() => runRichTextCommand('bold')} className="rounded-md border border-[#c4c6cd] bg-white p-1.5 text-[#44474c] hover:bg-[#efedef]"><Bold className="h-4 w-4" /></button>
                          <button type="button" onClick={() => runRichTextCommand('italic')} className="rounded-md border border-[#c4c6cd] bg-white p-1.5 text-[#44474c] hover:bg-[#efedef]"><Italic className="h-4 w-4" /></button>
                          <button type="button" onClick={() => runRichTextCommand('formatBlock', '<h2>')} className="rounded-md border border-[#c4c6cd] bg-white p-1.5 text-[#44474c] hover:bg-[#efedef]"><Heading2 className="h-4 w-4" /></button>
                          <button type="button" onClick={() => runRichTextCommand('insertUnorderedList')} className="rounded-md border border-[#c4c6cd] bg-white p-1.5 text-[#44474c] hover:bg-[#efedef]"><List className="h-4 w-4" /></button>
                          <button type="button" onClick={() => runRichTextCommand('insertOrderedList')} className="rounded-md border border-[#c4c6cd] bg-white p-1.5 text-[#44474c] hover:bg-[#efedef]"><ListOrdered className="h-4 w-4" /></button>
                          <button type="button" onClick={() => runRichTextCommand('formatBlock', '<blockquote>')} className="rounded-md border border-[#c4c6cd] bg-white p-1.5 text-[#44474c] hover:bg-[#efedef]"><Quote className="h-4 w-4" /></button>
                          <button
                            type="button"
                            onClick={() => {
                              const url = window.prompt('Enter link URL');
                              if (url) {
                                runRichTextCommand('createLink', url);
                              }
                            }}
                            className="rounded-md border border-[#c4c6cd] bg-white p-1.5 text-[#44474c] hover:bg-[#efedef]"
                          >
                            <LinkIcon className="h-4 w-4" />
                          </button>
                        </div>
                        <div
                          ref={richTextRef}
                          contentEditable
                          suppressContentEditableWarning
                          onInput={(e) => setEditingPost({ ...editingPost, content: (e.currentTarget as HTMLDivElement).innerHTML })}
                          dangerouslySetInnerHTML={{ __html: draftContent || '<p></p>' }}
                          className={`w-full rounded-xl border border-[#c4c6cd] px-4 py-3 text-sm focus:border-[#041627] focus:outline-none focus:ring-1 focus:ring-[#041627] overflow-y-auto ${editorView === 'split' ? 'h-72' : 'h-[520px]'}`}
                        />
                      </>
                    ) : (
                      <textarea
                        value={draftContent}
                        onChange={(e) => setEditingPost({ ...editingPost, content: e.target.value })}
                        className={`w-full rounded-xl border border-[#c4c6cd] px-4 py-3 font-mono text-sm focus:border-[#041627] focus:outline-none focus:ring-1 focus:ring-[#041627] ${editorView === 'split' ? 'h-72' : 'h-[520px]'}`}
                        placeholder={contentFormat === 'html' ? '<h2>Heading</h2>\n<p>Your HTML content here...</p>' : '# Heading 1\n\nWrite your story here...'}
                      />
                    )}
                  </>
                )}

                {(editorView === 'preview' || editorView === 'split') && (
                  <div className={`rounded-xl border border-[#e4e2e3] bg-[#fafafa] ${editorView === 'split' ? 'mt-4 h-72' : 'h-[520px]'} overflow-y-auto p-4`}>
                    {draftContent.trim() ? (
                      contentFormat === 'markdown' ? (
                        <div className="prose prose-sm max-w-none">
                          <Markdown>{draftContent}</Markdown>
                        </div>
                      ) : (
                        <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: draftContent }} />
                      )
                    ) : (
                      <div className="text-sm text-[#74777d]">Preview will appear here once you start writing.</div>
                    )}
                  </div>
                )}
              </div>
            </section>

            <aside className="space-y-5">
              <div className="rounded-2xl border border-[#e4e2e3] bg-white p-4 shadow-sm">
                <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.08em] text-[#74777d]">Publish</h3>
                <label className="mb-4 inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={editingPost.isFeatured || false}
                    onChange={(e) => setEditingPost({ ...editingPost, isFeatured: e.target.checked })}
                    className="h-4 w-4 rounded"
                  />
                  <span className="text-sm font-semibold text-[#44474c]">Set as Featured Post</span>
                </label>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="w-full rounded-lg bg-[#041627] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#041627]/90 disabled:opacity-50"
                >
                  {saving ? (
                    <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Saving...</span>
                  ) : (
                    <span className="inline-flex items-center gap-2"><Save className="h-4 w-4" /> Save Post</span>
                  )}
                </button>
              </div>

              <div className="rounded-2xl border border-[#e4e2e3] bg-white p-4 shadow-sm space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-[0.08em] text-[#74777d]">Post Settings</h3>
                <div>
                  <label className="mb-1 block text-xs font-bold text-[#44474c]">Category</label>
                  <input
                    type="text"
                    value={editingPost.category || ''}
                    onChange={(e) => setEditingPost({ ...editingPost, category: e.target.value })}
                    className="w-full rounded-lg border border-[#c4c6cd] px-3 py-2 text-sm"
                    placeholder="e.g. Travel Stories"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold text-[#44474c]">Thumbnail URL</label>
                  <input
                    type="text"
                    value={editingPost.imageUrl || ''}
                    onChange={(e) => setEditingPost({ ...editingPost, imageUrl: e.target.value })}
                    className="w-full rounded-lg border border-[#c4c6cd] px-3 py-2 text-sm"
                    placeholder="https://..."
                  />
                  <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#e4e2e3] bg-[#f8f7f7] p-2">
                    {editingPost.imageUrl ? (
                      <img src={editingPost.imageUrl} alt={editingPost.title || 'Thumbnail preview'} className="h-12 w-12 rounded-md object-cover" />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-md bg-[#efedef] text-[#74777d]"><ImageIcon className="h-5 w-5" /></div>
                    )}
                    <span className="text-xs text-[#74777d]">Card thumbnail preview</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e4e2e3] bg-white p-4 shadow-sm">
                <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.08em] text-[#74777d]">SEO & Excerpt</h3>
                <textarea
                  value={draftExcerpt}
                  onChange={(e) => setEditingPost({ ...editingPost, excerpt: e.target.value })}
                  className="h-28 w-full rounded-lg border border-[#c4c6cd] px-3 py-2 text-sm"
                  placeholder="Short description for cards and search previews"
                />
                <p className="mt-1 text-xs text-[#74777d]">{draftExcerpt.length} characters</p>
              </div>
            </aside>
          </div>
        </main>

        <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-8">
          <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">{siteSettings.footerTitle}</div>
          <div className="flex flex-wrap justify-center gap-3 md:gap-6">
            <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Privacy Policy</a>
            <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Terms of Service</a>
            <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Editorial Policy</a>
          </div>
          <div className="text-[#44474c]">{siteSettings.footerCopyright}</div>
        </footer>
        <MobileBottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fbf9fa] text-[#1b1c1d] flex flex-col">
      <TopNavBar />
      <main className="flex-1 w-full max-w-[1280px] mx-auto px-3 md:px-6 pt-[110px] pb-28 md:pb-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[28px] font-bold leading-tight">Blog Administration</h1>
            <p className="text-[#44474c]">Manage travel stories and publishing highlights with a consistent editorial workflow.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/blog" className="inline-flex items-center px-4 py-2 rounded-full border border-[#c4c6cd] bg-white text-[#1b1c1d] font-semibold hover:bg-[#efedef] transition-colors">
              View Blog
            </Link>
            <button onClick={startNew} className="inline-flex items-center gap-2 bg-[#041627] hover:bg-[#041627]/90 text-white px-4 py-2 rounded-full font-semibold">
              <Plus className="w-4 h-4" /> New Post
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mb-6 border border-red-200 bg-red-50 text-red-700 rounded-xl px-4 py-3 text-sm">
            {errorMsg}
          </div>
        )}

        {infoMsg && (
          <div className="mb-6 border border-emerald-200 bg-emerald-50 text-emerald-700 rounded-xl px-4 py-3 text-sm">
            {infoMsg}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-gray-400" /></div>
        ) : posts.length === 0 ? (
          <div className="text-center p-12 bg-white rounded-xl border border-[#e4e2e3] text-[#44474c]">
            <p className="mb-4">No blog posts found. Create your first one!</p>
            <button onClick={handleSeed} disabled={seeding} className="bg-[#efedef] hover:bg-[#e4e2e3] text-[#1b1c1d] px-4 py-2 rounded-lg font-bold inline-flex items-center gap-2">
              {seeding ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Seed Mock Posts
            </button>
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-3">
              {posts.map((post) => {
                const isConfirming = confirmDeleteId === post.id;
                return (
                  <article key={post.id} className="bg-white rounded-xl border border-[#e4e2e3] p-3 shadow-sm">
                    <div className="flex items-start gap-3">
                      {post.imageUrl ? (
                        <img src={post.imageUrl} alt={post.title} className="w-14 h-14 rounded-lg object-cover border border-[#e4e2e3] shrink-0" />
                      ) : (
                        <div className="w-14 h-14 rounded-lg bg-[#efedef] border border-[#e4e2e3] flex items-center justify-center text-[#74777d] shrink-0">
                          <ImageIcon className="w-4 h-4" />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-[#1b1c1d] line-clamp-2">{post.title}</h3>
                        <p className="text-xs text-[#74777d] line-clamp-2 mt-0.5">{post.excerpt}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[#74777d]">
                          <span>{post.category || '-'}</span>
                          <span>•</span>
                          <span>{new Date(post.updatedAt || post.createdAt).toLocaleDateString()}</span>
                          <span>•</span>
                          {post.isFeatured ? (
                            <span className="text-blue-700 font-semibold">Featured</span>
                          ) : (
                            <span className="font-semibold">Standard</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <button onClick={() => startEdit(post)} className="flex-1 inline-flex items-center justify-center gap-1 text-[#041627] bg-[#efedef] px-3 py-2 rounded-lg text-xs font-semibold"><Edit2 className="w-4 h-4" />Edit</button>
                      <button onClick={() => setConfirmDeleteId(post.id)} className="flex-1 inline-flex items-center justify-center gap-1 text-red-600 bg-red-50 px-3 py-2 rounded-lg text-xs font-semibold"><Trash2 className="w-4 h-4" />Delete</button>
                    </div>

                    {isConfirming && (
                      <div className="mt-2 flex items-center gap-2">
                        <button onClick={() => handleDelete(post.id)} className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700">
                          <Check className="w-3.5 h-3.5" />Confirm
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="flex-1 inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#c4c6cd] text-[#44474c] text-xs font-semibold hover:bg-[#efedef]">
                          <X className="w-3.5 h-3.5" />Cancel
                        </button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>

            <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-[#e4e2e3] overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#f5f3f4] border-b border-[#e4e2e3] text-[#44474c] text-sm">
                    <th className="p-4 font-bold">Post</th>
                    <th className="p-4 font-bold">Category</th>
                    <th className="p-4 font-bold">Updated</th>
                    <th className="p-4 font-bold">Status</th>
                    <th className="p-4 font-bold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {posts.map((post) => {
                    const isConfirming = confirmDeleteId === post.id;
                    return (
                      <tr key={post.id} className="border-b border-[#efedef] hover:bg-[#faf9fa] align-top">
                        <td className="p-4">
                          <div className="flex items-center gap-3">
                            {post.imageUrl ? (
                              <img src={post.imageUrl} alt={post.title} className="w-12 h-12 rounded-lg object-cover border border-[#e4e2e3]" />
                            ) : (
                              <div className="w-12 h-12 rounded-lg bg-[#efedef] border border-[#e4e2e3] flex items-center justify-center text-[#74777d]">
                                <ImageIcon className="w-4 h-4" />
                              </div>
                            )}
                            <div>
                              <div className="font-bold text-[#1b1c1d] line-clamp-1">{post.title}</div>
                              <div className="text-xs text-[#74777d] line-clamp-1">{post.excerpt}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 text-sm text-[#44474c]">{post.category || '-'}</td>
                        <td className="p-4 text-sm text-[#74777d]">{new Date(post.updatedAt || post.createdAt).toLocaleDateString()}</td>
                        <td className="p-4">
                          {post.isFeatured ? (
                            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-bold">Featured</span>
                          ) : (
                            <span className="text-xs bg-[#efedef] text-[#44474c] px-2 py-0.5 rounded-full font-semibold">Standard</span>
                          )}
                        </td>
                        <td className="p-4 text-right">
                          <div className="flex justify-end items-center gap-2">
                            <button onClick={() => startEdit(post)} className="inline-flex items-center gap-1 text-[#041627] hover:bg-[#efedef] px-2.5 py-1.5 rounded-lg text-xs font-semibold"><Edit2 className="w-4 h-4" />Edit</button>
                            <button onClick={() => setConfirmDeleteId(post.id)} className="inline-flex items-center gap-1 text-red-600 hover:bg-red-50 px-2.5 py-1.5 rounded-lg text-xs font-semibold"><Trash2 className="w-4 h-4" />Delete</button>
                          </div>

                          {isConfirming && (
                            <div className="mt-2 flex justify-end items-center gap-2">
                              <button onClick={() => handleDelete(post.id)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-red-600 text-white text-xs font-semibold hover:bg-red-700">
                                <Check className="w-3.5 h-3.5" />Confirm
                              </button>
                              <button onClick={() => setConfirmDeleteId(null)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-[#c4c6cd] text-[#44474c] text-xs font-semibold hover:bg-[#efedef]">
                                <X className="w-3.5 h-3.5" />Cancel
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      <footer className="bg-[#f5f3f4] text-[#1b1c1d] text-[12px] md:text-[14px] font-['Plus_Jakarta_Sans'] border-t border-[#e4e2e3] w-full py-6 md:py-8 px-4 md:px-6 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-6 pb-20 md:pb-8 mt-8">
        <div className="text-[16px] md:text-[18px] font-bold text-[#1b1c1d]">{siteSettings.footerTitle}</div>
        <div className="flex flex-wrap justify-center gap-3 md:gap-6">
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Privacy Policy</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Terms of Service</a>
          <a className="text-[#44474c] hover:text-[#1b1c1d] underline" href="#">Editorial Policy</a>
        </div>
        <div className="text-[#44474c]">{siteSettings.footerCopyright}</div>
      </footer>

      <MobileBottomNav />
    </div>
  );
};

export default AdminBlogPage;
