import { apiRequest } from './api';

export interface BlogPost {
  id: string;
  title: string;
  excerpt: string;
  content: string;
  createdAt: number;
  updatedAt: number;
  imageUrl: string;
  category: string;
  isFeatured: boolean;
  authorId: number;
}

export const blogService = {
  async getPosts(): Promise<BlogPost[]> {
    const response = await apiRequest<{ posts: BlogPost[] }>('/blog-posts');
    return response.posts;
  },

  async getPostById(id: string): Promise<BlogPost | null> {
    try {
      const response = await apiRequest<{ post: BlogPost }>(`/blog-posts/${id}`);
      return response.post;
    } catch {
      return null;
    }
  },

  async createPost(post: Omit<BlogPost, 'id' | 'createdAt' | 'updatedAt' | 'authorId'>, customId?: string): Promise<string> {
    const id = customId || `post_${Math.random().toString(36).slice(2, 8)}`;
    const response = await apiRequest<{ post: BlogPost }>('/blog-posts', {
      method: 'POST',
      body: JSON.stringify({ ...post, id, authorId: 0 }),
    });
    return response.post.id;
  },

  async updatePost(id: string, post: Partial<Omit<BlogPost, 'id' | 'createdAt' | 'authorId'>>): Promise<void> {
    await apiRequest(`/blog-posts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(post),
    });
  },

  async deletePost(id: string): Promise<void> {
    await apiRequest(`/blog-posts/${id}`, {
      method: 'DELETE',
    });
  }
};
