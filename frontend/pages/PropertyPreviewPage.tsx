import React, { useMemo, useRef, useState } from 'react';
import { ExternalLink, Grid, MapPin, Star } from 'lucide-react';
import BookingWidget from '../components/BookingWidget';
import { PropertyData } from '../types';

interface PropertyPreviewPageProps {
  data: PropertyData;
}

const PlatformRow: React.FC<{ url?: string; name: string; color: string }> = ({ url, name, color }) => {
  if (!url) return null;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between rounded-xl border border-[#e4e2e3] bg-white p-3 hover:shadow-sm transition-shadow"
    >
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-8 rounded-lg text-white font-bold flex items-center justify-center text-sm"
          style={{ backgroundColor: color }}
        >
          {name.charAt(0)}
        </div>
        <div>
          <div className="text-[13px] font-semibold text-[#1b1c1d]">{name}</div>
          <div className="text-[11px] text-[#74777d]">Book on {name}</div>
        </div>
      </div>
      <ExternalLink className="w-4 h-4 text-[#74777d]" />
    </a>
  );
};

const PropertyPreviewPage: React.FC<PropertyPreviewPageProps> = ({ data }) => {
  const mobileSliderRef = useRef<HTMLDivElement | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);

  const mainImages = useMemo(() => {
    const featured = data.galleryImages.filter((img) => img.showOnHome).map((img) => img.url);
    const others = data.galleryImages.filter((img) => !img.showOnHome).map((img) => img.url);
    const merged = [...featured, ...others].filter(Boolean);

    if (merged.length > 0) {
      return merged.slice(0, 5);
    }

    return [
      'https://images.unsplash.com/photo-1556228453-efd6c1ff04f6?auto=format&fit=crop&q=80&w=1200',
      'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&q=80&w=900',
      'https://images.unsplash.com/photo-1540518614846-7eded433c457?auto=format&fit=crop&q=80&w=900',
    ];
  }, [data.galleryImages]);

  const handleSliderScroll = () => {
    if (!mobileSliderRef.current) return;
    const { scrollLeft, offsetWidth } = mobileSliderRef.current;
    setActiveSlide(Math.round(scrollLeft / offsetWidth));
  };

  const visibleHighlights = data.highlights.slice(0, 4);
  const visibleAmenities = data.amenities.slice(0, 8);
  const visibleRooms = data.sleepingArrangements.slice(0, 4);

  return (
    <div className="bg-[#fbf9fa] pb-8 md:pb-10">
      <div className="md:hidden relative">
        <div
          ref={mobileSliderRef}
          onScroll={handleSliderScroll}
          className="w-full h-[250px] overflow-x-auto flex snap-x snap-mandatory no-scrollbar bg-[#e4e2e3]"
        >
          {mainImages.map((img, idx) => (
            <img
              key={idx}
              src={img}
              className="w-full h-full object-cover flex-shrink-0 snap-center"
              alt={`Preview ${idx + 1}`}
              loading={idx === 0 ? 'eager' : 'lazy'}
            />
          ))}
        </div>
        <div className="absolute bottom-3 right-3 bg-black/60 text-white text-xs px-2.5 py-1 rounded-full pointer-events-none">
          {Math.min(activeSlide + 1, mainImages.length)} / {mainImages.length}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 md:py-6">
        <div className="hidden md:flex items-start justify-between gap-4 rounded-xl border border-[#e4e2e3] bg-white p-5 mb-3">
          <div>
            <h1 className="font-['Plus_Jakarta_Sans'] text-[34px] leading-[1.15] font-bold text-[#041627] mb-2">{data.name}</h1>
            <div className="text-sm text-[#44474c] flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              <span>{data.address || 'Tokyo, Japan'}</span>
              <span>-</span>
              <a href="#" className="text-[#006ce4] font-semibold">Excellent location</a>
            </div>
          </div>

          <div className="flex items-start gap-2 shrink-0">
            <div className="text-right text-xs text-[#74777d]">
              <div className="text-[13px] text-[#1b1c1d] font-semibold">Wonderful</div>
              423 reviews
            </div>
            <div className="bg-[#006ce4] text-white rounded-[8px_8px_8px_0] min-w-11 h-11 flex items-center justify-center font-bold">
              9.1
            </div>
          </div>
        </div>

        <div className="hidden md:grid grid-cols-[2fr_1fr] gap-2 mb-4">
          <div className="relative min-h-[360px] rounded-xl overflow-hidden">
            <img src={mainImages[0]} alt="Main" className="w-full h-full object-cover" />
            <button className="absolute right-3 bottom-3 rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold text-[#1b1c1d] flex items-center gap-1.5">
              <Grid className="w-4 h-4" /> Show all photos
            </button>
          </div>
          <div className="grid grid-rows-2 gap-2 min-h-[360px]">
            <img src={mainImages[1] || mainImages[0]} alt="Gallery 1" className="w-full h-full object-cover rounded-xl" />
            <img src={mainImages[2] || mainImages[0]} alt="Gallery 2" className="w-full h-full object-cover rounded-xl" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-4 items-start">
          <div>
            <div className="rounded-xl border border-[#e4e2e3] bg-white px-4 flex gap-4 overflow-x-auto mb-3">
              <a href="#" className="py-3 border-b-2 border-[#006ce4] text-[#006ce4] text-sm font-semibold whitespace-nowrap">Overview</a>
              <a href="#" className="py-3 text-[#6f757f] text-sm font-semibold whitespace-nowrap">Facilities</a>
              <a href="#" className="py-3 text-[#6f757f] text-sm font-semibold whitespace-nowrap">House rules</a>
              <a href="#" className="py-3 text-[#6f757f] text-sm font-semibold whitespace-nowrap">Guest reviews</a>
            </div>

            <section className="rounded-xl border border-[#e4e2e3] bg-white p-4 mb-3">
              <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold text-[#041627] mb-3">Property highlights</h2>
              {visibleHighlights.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {visibleHighlights.map((item) => (
                    <div key={item.id} className="rounded-lg border border-[#e4e2e3] bg-[#fbfdff] p-3">
                      <div className="text-sm font-semibold text-[#1b1c1d] mb-1">{item.title}</div>
                      <div className="text-xs text-[#74777d] leading-relaxed">{item.description}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#74777d]">No highlights configured yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-[#e4e2e3] bg-white p-4 mb-3">
              <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold text-[#041627] mb-3">About this property</h2>
              <p className="text-[15px] leading-[1.75] text-[#44474c] whitespace-pre-line">{data.description}</p>
            </section>

            <section className="rounded-xl border border-[#e4e2e3] bg-white p-4 mb-3">
              <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold text-[#041627] mb-3">Most popular facilities</h2>
              {visibleAmenities.length > 0 ? (
                <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {visibleAmenities.map((amenity, idx) => (
                    <li key={`${amenity}-${idx}`} className="text-sm text-[#1b1c1d] flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0ea05a] shrink-0" />
                      {amenity}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-[#74777d]">No amenities configured yet.</p>
              )}
            </section>

            <section className="rounded-xl border border-[#e4e2e3] bg-white p-4 mb-3">
              <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold text-[#041627] mb-3">Room options</h2>
              {visibleRooms.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {visibleRooms.map((room) => (
                    <article key={room.id} className="rounded-lg border border-[#e4e2e3] bg-white overflow-hidden">
                      <img src={room.imageUrl} alt={room.title} className="w-full h-36 object-cover" loading="lazy" />
                      <div className="p-3">
                        <div className="text-sm font-semibold text-[#1b1c1d] mb-1">{room.title}</div>
                        <div className="text-xs text-[#74777d]">{room.description}</div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#74777d]">No room details configured yet.</p>
              )}
            </section>

            <section className="lg:hidden rounded-xl border border-[#e4e2e3] bg-white p-4 mb-3">
              <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold text-[#041627] mb-3">Also available on...</h2>
              <div className="space-y-2">
                <PlatformRow url={data.social.airbnbUrl} name="Airbnb" color="#FF385C" />
                <PlatformRow url={data.social.bookingUrl} name="Booking.com" color="#003580" />
                <PlatformRow url={data.social.agodaUrl} name="Agoda" color="#2a2a2a" />
              </div>
            </section>

            <section className="lg:hidden rounded-xl border border-[#e4e2e3] bg-white p-4 mb-3">
              <h2 className="font-['Plus_Jakarta_Sans'] text-xl font-bold text-[#041627] mb-3">Facebook Fanpage</h2>
              <div className="rounded-lg border border-[#e4e2e3] bg-[#f9fbff] p-3">
                <p className="text-sm text-[#44474c] leading-relaxed mb-3">Follow our fanpage to get latest promotions and updates.</p>
                <a
                  href={data.social.facebookUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center w-full rounded-lg bg-[#1877f2] border border-[#1877f2] text-white text-sm font-semibold py-2"
                >
                  Visit Fanpage
                </a>
              </div>
            </section>
          </div>

          <aside className="hidden lg:block sticky top-[88px] self-start">
            <div className="rounded-xl border border-[#e4e2e3] bg-white p-3 shadow-[0_8px_24px_rgba(16,24,40,0.06)] mb-3">
              <BookingWidget pricing={data.pricing} adminEmail={data.adminEmail} />
            </div>

            <section className="rounded-xl border border-[#e4e2e3] bg-white p-4 mb-3">
              <h3 className="font-['Plus_Jakarta_Sans'] text-[14px] font-bold text-[#041627] mb-3">Also available on...</h3>
              <div className="space-y-2">
                <PlatformRow url={data.social.airbnbUrl} name="Airbnb" color="#FF385C" />
                <PlatformRow url={data.social.bookingUrl} name="Booking.com" color="#003580" />
                <PlatformRow url={data.social.agodaUrl} name="Agoda" color="#2a2a2a" />
              </div>
            </section>

            <section className="rounded-xl border border-[#e4e2e3] bg-white p-4">
              <h3 className="font-['Plus_Jakarta_Sans'] text-[14px] font-bold text-[#041627] mb-3">Facebook Fanpage</h3>
              <div className="rounded-lg border border-[#e4e2e3] bg-[#f9fbff] p-3">
                <p className="text-sm text-[#44474c] leading-relaxed mb-3">Follow our fanpage to get latest promotions and updates.</p>
                <a
                  href={data.social.facebookUrl || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center w-full rounded-lg bg-[#1877f2] border border-[#1877f2] text-white text-sm font-semibold py-2"
                >
                  Visit Fanpage
                </a>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
};

export default PropertyPreviewPage;
