import React from 'react';
import { PropertyData, GalleryItem } from '../types';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

interface PhotoTourPageProps {
  data: PropertyData;
}

const PhotoTourPage: React.FC<PhotoTourPageProps> = ({ data }) => {
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Helper to get images for a specific category ID
  const getImagesByCategory = (catId: string) => {
      return (data.galleryImages ?? []).filter(img => img && img.category === catId);
  };

  // Helper to render a generic section
  const renderSection = (title: string, items: GalleryItem[]) => {
      if (items.length === 0) return null;
      return (
        <div className="mb-8" key={title}>
            <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map(item => (
                    <div key={item.id} className="space-y-2">
                        <div className="aspect-[4/3] rounded-sm overflow-hidden bg-gray-100">
                             <img src={item.url || undefined} loading="lazy" alt={item.caption} className="w-full h-full object-cover hover:scale-105 transition-transform duration-500" />
                        </div>
                        {item.caption && <p className="text-sm text-gray-600 font-medium">{item.caption}</p>}
                    </div>
                ))}
            </div>
        </div>
      );
  };

  // Pre-fetch images for special sections to avoid repeated filtering
  const planImages = getImagesByCategory('plan');
  const livingImages = getImagesByCategory('living');

  return (
    <div className="min-h-screen bg-white text-gray-900">
        {/* Header */}
        <div className="fixed top-0 left-0 right-0 bg-white/95 backdrop-blur z-50 px-4 py-4 border-b border-gray-100 flex items-center">
            <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-full mr-4">
                <ChevronLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold">{t('photos_title')}</h1>
        </div>

        <div className="pt-16 pb-16 max-w-5xl mx-auto px-4 sm:px-6">
            
            {/* 1. Floor Plan Section - Updated to match Living Room layout */}
            {planImages.length > 0 && (
                <div className="mb-10">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">{t('photos_floor_plan')}</h2>
                    
                    {/* Hero Image - Aspect Video like Living Room */}
                    <div className="mb-4 aspect-video rounded-sm overflow-hidden bg-gray-50 border border-gray-100">
                        {/* object-contain ensures the whole plan is visible without cropping */}
                        <img 
                            src={planImages[0].url || undefined} 
                            loading="lazy"
                            className="w-full h-full object-contain mix-blend-multiply"
                            alt={t('photos_floor_plan_alt')}
                        />
                    </div>
                    {planImages[0].caption && (
                         <p className="text-sm text-gray-500 mb-6">{planImages[0].caption}</p>
                    )}
                    
                    {/* Remaining Floor Plan Images (if any) */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {planImages.slice(1).map(item => (
                            <div key={item.id}>
                                <div className="aspect-[4/3] rounded-sm overflow-hidden bg-gray-100 mb-2">
                                    <img src={item.url || undefined} loading="lazy" className="w-full h-full object-cover hover:scale-105 transition-transform" alt="" />
                                </div>
                                <p className="text-sm text-gray-600 font-medium">{item.caption}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 2. Living Room (Hero Style - Only if 'living' category exists and has images) */}
            {livingImages.length > 0 && (
                <div className="mb-10">
                    <h2 className="text-xl font-bold text-gray-900 mb-4">{t('photos_living_room')}</h2>
                    {/* Hero Image */}
                    <div className="mb-4 aspect-video rounded-sm overflow-hidden bg-gray-100">
                        <img src={livingImages[0].url || undefined} loading="lazy" className="w-full h-full object-cover" alt={t('photos_living_room_alt')} />
                    </div>
                    {livingImages[0].caption && (
                         <p className="text-sm text-gray-500 mb-6">{livingImages[0].caption}</p>
                    )}
                    
                    {/* Remaining Living Images */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        {livingImages.slice(1).map(item => (
                            <div key={item.id}>
                                <div className="aspect-[4/3] rounded-sm overflow-hidden bg-gray-100 mb-2">
                                    <img src={item.url || undefined} loading="lazy" className="w-full h-full object-cover hover:scale-105 transition-transform" alt="" />
                                </div>
                                <p className="text-sm text-gray-600 font-medium">{item.caption}</p>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 3. Render all other dynamic categories */}
            {data.galleryCategories
                .filter(cat => cat.id !== 'plan' && cat.id !== 'living')
                .map(cat => {
                    const images = getImagesByCategory(cat.id);
                    return renderSection(cat.label, images);
                })
            }
            
            {/* 4. Catch-all for images with categories that were deleted but images remain */}
            {(() => {
                const knownCategoryIds = data.galleryCategories.map(c => c.id);
                const orphanedImages = data.galleryImages.filter(img => !knownCategoryIds.includes(img.category));
                if (orphanedImages.length > 0) {
                    return renderSection(t('photos_uncategorized'), orphanedImages);
                }
                return null;
            })()}

        </div>
    </div>
  );
};

export default PhotoTourPage;