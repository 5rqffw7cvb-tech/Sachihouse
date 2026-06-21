
import React from 'react';
import { PropertyData } from '../types';
import { MapPin, Train, Navigation, Clock, Youtube, PlayCircle, ExternalLink } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface AccessPageProps {
  data: PropertyData;
}

const AccessPage: React.FC<AccessPageProps> = ({ data }) => {
  const { t } = useLanguage();
  // Helper to extract YouTube ID from various URL formats
  const getYoutubeId = (url: string | undefined) => {
    if (!url) return null;
    // Updated regex to include 'shorts' and handle potential edge cases
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const videoId = getYoutubeId(data.accessInfo?.youtubeGuideUrl);
  // Construct a fallback URL for the button
  const videoUrl = data.accessInfo?.youtubeGuideUrl || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '#');
  
  // Use current origin for the 'origin' parameter to satisfy API requirements
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-8">
      <div className="text-center mb-8">
        <h1 className="text-[22px] md:text-[28px] font-bold text-gray-900 leading-[1.25] mb-3">{data.titles.access}</h1>
        <p className="text-[14px] md:text-[16px] text-gray-500 leading-[1.6] max-w-2xl mx-auto">
          {data.titles.accessSubtitle}
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden mb-8">
        {/* Adjusted height: h-[250px] for mobile, h-[500px] for desktop */}
        <div className="w-full h-[250px] md:h-[500px] bg-gray-100 relative group">
           <iframe 
             src={data.mapEmbedUrl}
             width="100%" 
             height="100%" 
             style={{border:0}} 
             allowFullScreen={true} 
             allow="compute-pressure"
             loading="lazy" 
             referrerPolicy="no-referrer-when-downgrade"
             className="grayscale group-hover:grayscale-0 transition-all duration-500"
             title={t('access_map_title')}
           ></iframe>
           <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur px-4 py-2 rounded-lg shadow-sm hidden md:block">
             <div className="flex items-center gap-2 font-semibold text-gray-800">
               <MapPin className="w-4 h-4 text-blue-600" />
               {data.address}
             </div>
           </div>
        </div>
      </div>

      {/* Modern Redesigned YouTube Video Section */}
      {videoId && (
        <div className="mb-8">
           <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100">
              
              {/* Header Bar */}
              <div className="px-5 py-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white">
                 <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm">
                       <Youtube className="w-6 h-6" />
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900 leading-tight">{t('access_video')}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">{t('access_video_desc')}</p>
                    </div>
                 </div>
                 {/* Functional Fallback Link */}
                 <a
                    href={videoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full self-start sm:self-center hover:bg-blue-100 transition-colors group"
                 >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {t('access_watch')}
                 </a>
              </div>

              {/* Edge-to-Edge Video Player */}
              <div className="aspect-video w-full bg-black relative">
                <iframe
                  className="absolute inset-0 w-full h-full"
                  src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&modestbranding=1&playsinline=1&iv_load_policy=3&origin=${origin}`}
                  title={t('access_video_iframe_title')}
                  frameBorder="0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; compute-pressure"
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                ></iframe>
              </div>
           </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
          <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
             <Train className="w-6 h-6 text-blue-600" />
          </div>
          <h3 className="font-bold text-gray-900 text-lg mb-2">{t('access_train')}</h3>
          {(data.accessInfo?.nearestStationName || data.accessInfo?.nearestStationDistance) && (
            <div className="mb-3 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-900">
              {data.accessInfo?.nearestStationName && (
                <div>
                  <span className="font-semibold">{t('access_nearest_station')}</span> {data.accessInfo.nearestStationName}
                </div>
              )}
              {data.accessInfo?.nearestStationDistance && (
                <div>
                  <span className="font-semibold">{t('access_distance')}</span> {data.accessInfo.nearestStationDistance}
                </div>
              )}
            </div>
          )}
          <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">
            {data.accessInfo?.train || t('access_no_train')}
          </p>
        </div>

        <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
             <Navigation className="w-6 h-6 text-green-600" />
          </div>
          <h3 className="font-bold text-gray-900 text-lg mb-2">{t('access_airport')}</h3>
          {data.accessInfo?.nearestAirportDriveTime && (
            <div className="mb-3 rounded-lg border border-green-100 bg-green-50 px-3 py-2 text-sm text-green-900">
              <span className="font-semibold">{t('access_nearest_airport_car')}</span> {data.accessInfo.nearestAirportDriveTime}
            </div>
          )}
          <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">
            {data.accessInfo?.airport || t('access_no_airport')}
          </p>
        </div>

        <div className="bg-gray-50 p-6 rounded-xl border border-gray-100">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center mb-4">
             <Clock className="w-6 h-6 text-amber-600" />
          </div>
          <h3 className="font-bold text-gray-900 text-lg mb-2">{t('access_checkin')}</h3>
           <p className="text-sm text-gray-600 whitespace-pre-line leading-relaxed">
            {data.accessInfo?.checkIn || t('access_no_checkin')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default AccessPage;
