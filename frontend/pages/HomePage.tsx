
import React, { useRef, useState, useEffect } from 'react';
import { PropertyData, SleepingArrangement } from '../types';
import { 
    Wifi, Monitor, Coffee, Wind, MapPin, BedDouble, User, X, ChevronRight, ChevronLeft, Image as ImageIcon,
  Tv, Car, Utensils, Waves, Dumbbell, Flame, Sun, Umbrella, Bath, Thermometer, 
  ShieldCheck, Key, Shirt, Speaker, Lock, Music, Grid, Droplets, Briefcase, ExternalLink,
    Refrigerator, Microwave, ShowerHead, ChevronUp, Medal, Train, Navigation
} from 'lucide-react';
import BookingWidget from '../components/BookingWidget';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';

interface HomePageProps {
  data: PropertyData;
}

const iconMap: Record<string, React.ElementType> = {
    Monitor, Wind, Wifi, Coffee, User
};

// Comprehensive mapping for Amenities
const AMENITY_ICONS: Record<string, React.ElementType> = {
  "Wifi": Wifi, "High-speed Wifi": Wifi, "TV": Tv, "Cable TV": Tv,
  "Kitchen": Utensils, "Washing Machine": Waves, "Washer": Waves, "Dryer": Wind,
  "Free parking": Car, "Air conditioning": Wind, "Heating": Thermometer,
  "Workspace": Monitor, "Dedicated workspace": Monitor, "Pool": Waves, "Hot tub": Bath,
  "Patio": Sun, "Balcony": Sun, "BBQ grill": Flame, "Gym": Dumbbell,
  "Breakfast": Coffee, "Smoke alarm": ShieldCheck, "Fire extinguisher": Flame,
  "First aid kit": Briefcase, "Hair dryer": Wind, "Iron": Shirt, "Shampoo": Droplets,
  "Essentials": Key, "Hangers": Shirt, "Sound system": Speaker, "Private entrance": Lock,
  "Beach access": Umbrella, "Piano": Music,
  // New Amenities
  "Refrigerator": Refrigerator,
  "Microwave": Microwave,
  "Rice cooker": Utensils,
  "Electric kettle": Coffee,
  "Self check-in": Key,
  "Shower": ShowerHead,
  "Steamer": Shirt,
  "Coffee maker": Coffee,
};

const getAmenityIcon = (name: string) => {
    if (AMENITY_ICONS[name]) return AMENITY_ICONS[name];
    const lowerName = name.toLowerCase();
    const keys = Object.keys(AMENITY_ICONS);
    for (const key of keys) {
        if (lowerName.includes(key.toLowerCase())) return AMENITY_ICONS[key];
    }
    return Wifi; // Fallback
};

// --- COMPONENTS ---

// Platform Button Component - Redesigned for Mobile Home Page
const PlatformButton: React.FC<{ url?: string; name: string; color: string; label: string }> = ({ url, name, color, label }) => {
    if (!url) return null;
    return (
        <a 
            href={url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="group flex items-center justify-between p-3 rounded-xl border border-gray-200 bg-white hover:border-blue-200 hover:shadow-md transition-all duration-200"
        >
            <div className="flex items-center gap-3">
                <div 
                    className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-extrabold text-xl shadow-sm" 
                    style={{ backgroundColor: color }}
                >
                    {name.charAt(0)}
                </div>
                <div className="flex flex-col">
                    <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider leading-none mb-0.5">{label}</span>
                    <span className="font-bold text-gray-900 leading-none">{name}</span>
                </div>
            </div>
            <ExternalLink className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
        </a>
    );
};


// 1. Modern Lightbox Gallery (Used for Room Details ONLY now)
const LightboxGallery: React.FC<{ 
    images: string[]; 
    initialIndex: number; 
    onClose: () => void;
    title?: string;
}> = ({ images, initialIndex, onClose, title }) => {
    const [activeIndex, setActiveIndex] = useState(initialIndex);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
            if (e.key === 'ArrowRight') nextImage();
            if (e.key === 'ArrowLeft') prevImage();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeIndex]);

    const nextImage = () => setActiveIndex((prev) => (prev + 1) % images.length);
    const prevImage = () => setActiveIndex((prev) => (prev - 1 + images.length) % images.length);

    return (
        <div className="fixed inset-0 z-[100] bg-black animate-in fade-in duration-200 flex flex-col">
            {/* Header */}
            <div className="absolute top-0 left-0 right-0 p-4 z-50 flex justify-between items-center text-white bg-gradient-to-b from-black/60 to-transparent">
                <div className="text-sm font-medium tracking-wide">
                     {activeIndex + 1} / {images.length} {title && `• ${title}`}
                </div>
                <button 
                    onClick={onClose} 
                    className="p-2 hover:bg-white/20 rounded-full transition-colors focus:outline-none"
                >
                    <X className="w-6 h-6 text-white" />
                </button>
            </div>

            {/* Main Image */}
            <div className="flex-1 flex items-center justify-center relative overflow-hidden group">
                {images[activeIndex] ? (
                    <img 
                        src={images[activeIndex]} 
                        alt={`Gallery ${activeIndex}`} 
                        className="max-w-full max-h-full object-contain transition-transform duration-300"
                    />
                ) : (
                    <div className="max-w-full max-h-full aspect-video bg-gray-800"></div>
                )}
                
                {/* Navigation Buttons */}
                {images.length > 1 && (
                    <>
                        <button onClick={(e) => { e.stopPropagation(); prevImage(); }} className="absolute left-4 p-3 rounded-full bg-black/40 text-white hover:bg-black/60 hover:scale-110 transition-all focus:outline-none hidden md:block">
                            <ChevronLeft className="w-8 h-8" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); nextImage(); }} className="absolute right-4 p-3 rounded-full bg-black/40 text-white hover:bg-black/60 hover:scale-110 transition-all focus:outline-none hidden md:block">
                            <ChevronRight className="w-8 h-8" />
                        </button>
                    </>
                )}
            </div>

            {/* Thumbnails Footer */}
            {images.length > 1 && (
                <div className="h-20 bg-black/90 flex items-center justify-center gap-2 overflow-x-auto px-4 py-2 no-scrollbar">
                    {images.map((img, idx) => (
                        <button
                            key={idx}
                            onClick={() => setActiveIndex(idx)}
                            className={`
                                relative w-12 h-12 flex-shrink-0 rounded-md overflow-hidden transition-all duration-300
                                ${activeIndex === idx ? 'opacity-100 ring-2 ring-white scale-110 z-10' : 'opacity-40 hover:opacity-70'}
                            `}
                        >
                            {img ? <img src={img} className="w-full h-full object-cover" alt="thumb" /> : <div className="w-full h-full bg-gray-800"></div>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

// 2. Room Carousel Component with Scroll Buttons
const RoomCarousel: React.FC<{ rooms: SleepingArrangement[]; onSelect: (room: SleepingArrangement) => void }> = ({ rooms, onSelect }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [showLeft, setShowLeft] = useState(false);
    const [showRight, setShowRight] = useState(true);

    const checkScroll = () => {
        if (!scrollRef.current) return;
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        setShowLeft(scrollLeft > 0);
        // Allow a small buffer (5px) for rounding errors
        setShowRight(scrollLeft + clientWidth < scrollWidth - 5);
    };

    useEffect(() => {
        checkScroll();
        window.addEventListener('resize', checkScroll);
        return () => window.removeEventListener('resize', checkScroll);
    }, [rooms]);

    const scroll = (direction: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const scrollAmount = 300; // Approx width of one card + gap
        scrollRef.current.scrollBy({
            left: direction === 'left' ? -scrollAmount : scrollAmount,
            behavior: 'smooth'
        });
    };

    return (
        <div className="relative group">
            {/* Scroll Buttons */}
            {showLeft && (
                <button 
                    onClick={() => scroll('left')}
                    className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 w-9 h-9 bg-white border border-gray-200 rounded-full shadow-lg flex items-center justify-center hover:scale-110 transition-all duration-200 focus:outline-none hidden md:flex"
                >
                    <ChevronLeft className="w-5 h-5 text-gray-700" />
                </button>
            )}
            
            {showRight && (
                <button 
                    onClick={() => scroll('right')}
                    className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 w-9 h-9 bg-white border border-gray-200 rounded-full shadow-lg flex items-center justify-center hover:scale-110 transition-all duration-200 focus:outline-none hidden md:flex"
                >
                    <ChevronRight className="w-5 h-5 text-gray-700" />
                </button>
            )}

            {/* Container */}
            <div 
                ref={scrollRef}
                onScroll={checkScroll}
                className="flex gap-5 overflow-x-auto pb-6 pt-2 px-1 snap-x snap-mandatory no-scrollbar"
                style={{ scrollBehavior: 'smooth' }}
            >
                {rooms.map((room) => (
                    <div 
                        key={room.id} 
                        onClick={() => onSelect(room)}
                        className="min-w-[280px] md:min-w-[320px] bg-white border border-gray-200 rounded-2xl overflow-hidden cursor-pointer snap-start transition-all duration-300 hover:shadow-xl hover:-translate-y-1 group/card"
                    >
                        <div className="h-52 bg-gray-100 relative overflow-hidden">
                            <img 
                                src={room.imageUrl} 
                                alt={room.title} 
                                loading="lazy" 
                                className="w-full h-full object-cover transition-transform duration-700 group-hover/card:scale-110" 
                            />
                            <div className="absolute inset-0 bg-black/0 group-hover/card:bg-black/10 transition-colors" />
                            <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs font-bold shadow-sm opacity-0 group-hover/card:opacity-100 transform translate-y-2 group-hover/card:translate-y-0 transition-all">
                                See Photos
                            </div>
                        </div>
                        <div className="p-5">
                            <h3 className="font-bold text-gray-900 text-lg mb-1">{room.title}</h3>
                            <p className="text-gray-500 text-sm flex items-center gap-2">
                                <BedDouble className="w-4 h-4" />
                                {room.description}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};


const HomePage: React.FC<HomePageProps> = ({ data }) => {
  const navigate = useNavigate();
  const { t, language } = useLanguage();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  
  // Gallery State (For Room Details only now)
  const [isGalleryOpen, setIsGalleryOpen] = useState(false);
  const [galleryImages, setGalleryImages] = useState<string[]>([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [galleryTitle, setGalleryTitle] = useState<string | undefined>(undefined);

  // --- LOGIC TO SELECT MAIN HERO IMAGES ---
  const safeGalleryImages = (Array.isArray(data.galleryImages) ? data.galleryImages : [])
    .filter((img): img is NonNullable<typeof data.galleryImages[number]> => !!img && typeof img === 'object')
    .filter((img) => typeof img.url === 'string' && !!img.url);

  // 1. Filter for images marked with 'showOnHome'
  const featuredImages = safeGalleryImages.filter((img) => !!img.showOnHome);
  // 2. Filter for others (to fallback)
  const otherImages = safeGalleryImages.filter((img) => !img.showOnHome);
  // 3. Combine them, prioritizing featured ones
  const pool = [...featuredImages, ...otherImages];

  // 4. Take top 5, or fallback to placeholder if completely empty
  const mainImages = (pool.length > 0)
    ? pool.slice(0, 5).map((img) => img.url)
    : Array(5).fill("https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&q=80&w=800");

  const { id } = useParams<{ id: string }>();
  // Navigation Handler
  const goToPhotoTour = () => {
      navigate(`/${id || 'main'}/photos`);
  };

  const openRoomGallery = (room: SleepingArrangement) => {
      const roomImages = [room.imageUrl, ...(room.photos || [])].filter(Boolean);
      setGalleryImages(roomImages.length > 0 ? roomImages : [room.imageUrl]);
      setGalleryIndex(0);
      setGalleryTitle(room.title);
      setIsGalleryOpen(true);
  };

  // Auto-slide logic for Mobile Hero
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      if (scrollRef.current) {
        const { scrollLeft, offsetWidth, scrollWidth } = scrollRef.current;
        if (scrollLeft + offsetWidth >= scrollWidth - 10) {
           scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
           scrollRef.current.scrollBy({ left: offsetWidth, behavior: 'smooth' });
        }
      }
    }, 3500); 
    return () => clearInterval(interval);
  }, [isPaused]);

  const handleScroll = () => {
      if (scrollRef.current) {
          const { scrollLeft, offsetWidth } = scrollRef.current;
          setActiveSlide(Math.round(scrollLeft / offsetWidth) % mainImages.length);
      }
  };

    const nearestStationName = data.accessInfo?.nearestStationName?.trim();
    const nearestStationReference = nearestStationName
        ? /station$/i.test(nearestStationName)
            ? nearestStationName
            : `${nearestStationName} station`
        : 'nearest station';
    const nearestStationDistanceInline = data.accessInfo?.nearestStationDistance
        ? `(${data.accessInfo.nearestStationDistance} from ${nearestStationReference})`
        : '';
    const bathFacilityBaseLabel = data.bathFacilityType === 'shower_room' ? 'Shower Room' : 'Bathroom';
    const bathFacilityLabel = data.baths === 1 ? bathFacilityBaseLabel : `${bathFacilityBaseLabel}s`;

  return (
    <div className="pb-8 md:pb-10">
      
      {/* ROOM LIGHTBOX */}
      {isGalleryOpen && (
          <LightboxGallery 
            images={galleryImages} 
            initialIndex={galleryIndex} 
            onClose={() => setIsGalleryOpen(false)} 
            title={galleryTitle}
          />
      )}

      {/* Mobile Hero Image Gallery */}
      <section className="md:hidden relative group">
          <div 
            ref={scrollRef}
            onScroll={handleScroll}
            onTouchStart={() => setIsPaused(true)}
            onTouchEnd={() => setIsPaused(false)}
            className="w-full h-[250px] overflow-x-auto flex snap-x snap-mandatory no-scrollbar bg-gray-100"
          >
            {mainImages.map((img, idx) => (
                <img 
                    key={idx} 
                    src={img} 
                    onClick={goToPhotoTour}
                    // Performance Optimization: Only load the first image eagerly. 
                    // Set fetchPriority to high for LCP optimization.
                    loading={idx === 0 ? "eager" : "lazy"}
                    fetchPriority={idx === 0 ? "high" : "auto"}
                    decoding="async"
                    className="w-full h-full object-cover flex-shrink-0 snap-center" 
                    alt={`View ${idx + 1}`} 
                />
            ))}
          </div>
          <div className="absolute bottom-4 right-4 bg-black/60 text-white px-3 py-1 text-xs font-medium rounded-full backdrop-blur-sm pointer-events-none">
              {activeSlide + 1} / {mainImages.length}
          </div>
      </section>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        
        {/* Desktop Hero & Title */}
        <section className="hidden md:block py-6">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h1 className="text-[24px] md:text-[28px] font-bold text-gray-900 leading-[1.25] mb-2">{data.name}</h1>
                    <div className="flex items-center gap-2 text-[14px] text-gray-600 leading-[1.6]">
                        <span className="font-medium underline decoration-gray-300 underline-offset-4">{data.address}</span>
                        {nearestStationDistanceInline && (
                            <span className="rounded-full bg-amber-100/80 px-2 py-0.5 font-semibold text-amber-800">
                                {nearestStationDistanceInline}
                            </span>
                        )}
                        <span>•</span>
                        <div className="flex items-center gap-1 text-blue-600 font-medium">
                            <Monitor className="w-3 h-3" />
                            {data.subtitle}
                        </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-gray-600 leading-[1.6]">
                        <span>{data.maxGuests} Guests</span>
                        <span>{data.bedrooms} Bedrooms</span>
                        <span>{data.beds} Beds</span>
                        <span>{data.baths} {bathFacilityLabel}</span>
                        <span>{data.toilets} Toilets</span>
                    </div>
                    {data.accessInfo?.nearestAirportDriveTime && (
                        <div className="mt-3 flex flex-wrap gap-2">
                            <div className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-[12px] font-semibold text-green-900">
                                <Navigation className="h-3.5 w-3.5" />
                                <span>Nearest airport by car · {data.accessInfo.nearestAirportDriveTime}</span>
                            </div>
                        </div>
                    )}
                </div>
                {/* Share/Save buttons could go here */}
            </div>

            {/* Desktop Hero Grid */}
            <div className="grid grid-cols-4 gap-2 h-[480px] rounded-2xl overflow-hidden relative">
                <div className="col-span-2 h-full relative group cursor-pointer" onClick={goToPhotoTour}>
                    {mainImages[0] ? (
                        <img 
                            src={mainImages[0]} 
                            className="w-full h-full object-cover hover:brightness-90 transition-all duration-300" 
                            alt="Main View" 
                            fetchPriority="high"
                            loading="eager"
                            decoding="async"
                        />
                    ) : (
                        <div className="w-full h-full bg-gray-200"></div>
                    )}
                </div>
                <div className="grid grid-rows-2 gap-2 h-full">
                    {mainImages[1] && <img src={mainImages[1]} loading="lazy" className="w-full h-full object-cover cursor-pointer hover:brightness-90 transition-all duration-300" alt="Gallery 1" onClick={goToPhotoTour}/>}
                    {mainImages[2] && <img src={mainImages[2]} loading="lazy" className="w-full h-full object-cover cursor-pointer hover:brightness-90 transition-all duration-300" alt="Gallery 2" onClick={goToPhotoTour}/>}
                </div>
                <div className="grid grid-rows-2 gap-2 h-full">
                    {mainImages[3] && <img src={mainImages[3]} loading="lazy" className="w-full h-full object-cover cursor-pointer hover:brightness-90 transition-all duration-300" alt="Gallery 3" onClick={goToPhotoTour}/>}
                    <div className="relative cursor-pointer" onClick={goToPhotoTour}>
                        {mainImages[4] && <img src={mainImages[4]} loading="lazy" className="w-full h-full object-cover hover:brightness-90 transition-all duration-300" alt="Gallery 4" />}
                    </div>
                </div>

                {/* Show All Photos Button */}
                <button 
                    onClick={goToPhotoTour}
                    className="absolute bottom-6 right-6 bg-white border border-gray-900/10 px-4 py-2 rounded-xl shadow-md hover:scale-105 hover:bg-gray-50 transition-all flex items-center gap-2 font-semibold text-sm text-gray-800"
                >
                    <Grid className="w-4 h-4" />
                    {t('home_show_photos')}
                </button>
            </div>
        </section>

        {/* Mobile Title Section */}
        <section className="md:hidden py-4 border-b border-gray-100">
             <h1 className="text-[22px] font-bold text-gray-900 leading-[1.25] mb-2">{data.name}</h1>
             <div className="flex items-center gap-2 text-[14px] text-gray-600 leading-[1.6]">
                 <MapPin className="w-4 h-4"/>
                 <span className="truncate">{data.address}</span>
                 {nearestStationDistanceInline && (
                     <span className="rounded-full bg-amber-100/80 px-2 py-0.5 font-semibold text-amber-800">
                         {nearestStationDistanceInline}
                     </span>
                 )}
             </div>
             <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-gray-600 leading-[1.6]">
                 <span>{data.maxGuests} Guests</span>
                 <span>{data.bedrooms} Bedrooms</span>
                 <span>{data.beds} Beds</span>
                 <span>{data.baths} {bathFacilityLabel}</span>
                 <span>{data.toilets} Toilets</span>
             </div>
             {data.accessInfo?.nearestAirportDriveTime && (
                 <div className="mt-3 flex flex-wrap gap-2">
                     <div className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-900">
                         <Navigation className="h-3 w-3" />
                         <span>Airport by car · {data.accessInfo.nearestAirportDriveTime}</span>
                     </div>
                 </div>
             )}
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 mt-6">
            {/* Main Content */}
            <div className="lg:col-span-2">
                
                {/* Host Info - Redesigned */}
                <div className="py-6 border-b border-gray-200">
                    <div className="flex items-start md:items-center gap-6">
                        {/* Left: Avatar */}
                        <div className="relative flex-shrink-0">
                            <img
                                src={data.hostImageUrl || "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=100&h=100"}
                                alt={data.hostName}
                                loading="lazy"
                                className="w-20 h-20 rounded-full object-cover border-[3px] border-white shadow-lg"
                            />
                        </div>

                        {/* Right: Info */}
                        <div className="flex-1">
                            <h2 className="text-[20px] md:text-[24px] font-bold text-gray-900 leading-[1.3] mb-1">
                                {t('home_hosted_by')} {data.hostName}
                            </h2>
                            {data.isSuperhost && (
                                <div className="flex flex-wrap items-center gap-y-1 gap-x-3 text-sm text-gray-500 mb-2">
                                    {data.social.airbnbUrl ? (
                                        <a 
                                            href={data.social.airbnbUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-bold text-gray-900 flex items-center gap-1 hover:text-rose-600 transition-colors hover:underline decoration-rose-500 underline-offset-2"
                                            title="View on Airbnb"
                                        >
                                            <Medal className="w-4 h-4 text-rose-500" /> Airbnb {t('home_superhost')}
                                        </a>
                                    ) : (
                                        <span className="font-bold text-gray-900 flex items-center gap-1">
                                            <Medal className="w-4 h-4 text-rose-500" /> Airbnb {t('home_superhost')}
                                        </span>
                                    )}
                                    
                                    {data.superhostSince && (
                                        <>
                                            <span className="hidden sm:inline">•</span>
                                            <span>Superhost since {data.superhostSince}</span>
                                        </>
                                    )}
                                </div>
                            )}
                            {/* Removed the line about guests/bedrooms/beds/bath as requested */}
                        </div>
                    </div>
                </div>

                {/* Highlights */}
                {(data.highlights || []).length > 0 && (
                    <div className="py-6 border-b border-gray-200 space-y-4">
                        {data.highlights.map(item => {
                            const Icon = iconMap[item.icon] || Monitor;
                            return (
                                <div key={item.id} className="flex gap-4">
                                    <Icon className="w-6 h-6 text-gray-700 mt-1" />
                                    <div>
                                        <h3 className="font-semibold text-gray-900">{item.title}</h3>
                                        <p className="text-gray-500 text-sm">{item.description}</p>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Description */}
                <div className="py-6 border-b border-gray-200">
                    <h2 className="text-[20px] md:text-[24px] font-bold text-gray-900 leading-[1.3] mb-4">{data.titles.about && language === 'en' ? data.titles.about : t('nav_home')}</h2>
                    <div className={`relative transition-all duration-500 overflow-hidden ${isDescriptionExpanded ? 'max-h-full' : 'max-h-[165px]'}`}>
                        <p className="text-[15px] md:text-[16px] text-[#2c2f33] leading-[1.75] whitespace-pre-line">
                            {data.description}
                        </p>
                        {!isDescriptionExpanded && (
                            <div className="absolute bottom-0 left-0 w-full h-20 bg-gradient-to-t from-white to-transparent" />
                        )}
                    </div>
                    
                    <button 
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                        className="mt-4 flex items-center gap-1.5 font-bold text-gray-900 underline decoration-gray-300 underline-offset-4 hover:text-blue-600 transition-colors"
                    >
                        {isDescriptionExpanded ? (
                            <>{t('home_show_less')} <ChevronUp className="w-4 h-4" /></>
                        ) : (
                            <>{t('home_show_more')} <ChevronRight className="w-4 h-4" /></>
                        )}
                    </button>
                </div>

                {/* Where you'll sleep */}
                <div className="py-4 border-b border-gray-200">
                     <h2 className="text-[20px] md:text-[24px] font-bold text-gray-900 leading-[1.3] mb-6">{data.titles.sleeping && language === 'en' ? data.titles.sleeping : t('home_sleep')}</h2>
                     {data.sleepingArrangements && data.sleepingArrangements.length > 0 ? (
                        <RoomCarousel rooms={data.sleepingArrangements} onSelect={openRoomGallery} />
                     ) : (
                         <div className="p-4 border border-gray-100 rounded-lg bg-gray-50 text-gray-500 text-sm">
                             No sleeping arrangement details available.
                         </div>
                     )}
                </div>

                {/* Amenities Preview */}
                <div className="py-4 border-b border-gray-200">
                    <h2 className="text-[20px] md:text-[24px] font-bold text-gray-900 leading-[1.3] mb-6">{data.titles.amenities && language === 'en' ? data.titles.amenities : t('home_amenities')}</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-4 gap-x-8">
                        {data.amenities.map((item, idx) => {
                            const Icon = getAmenityIcon(item);
                            return (
                                <div key={idx} className="flex items-center gap-3 text-gray-700">
                                    <Icon className="w-6 h-6 text-gray-500" strokeWidth={1.5} />
                                    <span className="text-base">{item}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

            </div>

            {/* Sticky Sidebar */}
            <div className="col-span-1 mt-8 lg:mt-0">
                <BookingWidget pricing={data.pricing} adminEmail={data.adminEmail} />
                
                {/* Mobile Only: Platform Links (Now below BookingWidget) */}
                <div className="py-6 md:hidden">
                    <h2 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <span className="w-1 h-5 bg-blue-600 rounded-full"></span>
                        {t('home_also_on')}
                    </h2>
                    <div className="grid grid-cols-1 gap-3">
                         <PlatformButton url={data.social.airbnbUrl} name="Airbnb" color="#FF385C" label={t('home_book_on')} />
                         <PlatformButton url={data.social.bookingUrl} name="Booking.com" color="#003580" label={t('home_book_on')} />
                         <PlatformButton url={data.social.agodaUrl} name="Agoda" color="#2a2a2a" label={t('home_book_on')} />
                    </div>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default HomePage;
