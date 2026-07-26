
import React, { useState, useEffect } from 'react';
import { PropertyData } from '../types';
import { isDateBlocked } from '../services/storage';
import { Info, Sparkles, Tag } from 'lucide-react';
import { format, addMonths, endOfMonth, eachDayOfInterval } from 'date-fns';
import BookingWidget from '../components/BookingWidget';
import { useLocation } from 'react-router-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { getDateFnsLocale } from '../utils/translations';

interface PricingPageProps {
  data: PropertyData;
}

const startOfMonth = (date: Date): Date => {
  const newDate = new Date(date);
  newDate.setDate(1);
  newDate.setHours(0, 0, 0, 0);
  return newDate;
};

const PricingPage: React.FC<PricingPageProps> = ({ data }) => {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const location = useLocation();
  const { t, language } = useLanguage();
  const dateLocale = getDateFnsLocale(language);
  const weekdayLabels = [t('weekday_sun'), t('weekday_mon'), t('weekday_tue'), t('weekday_wed'), t('weekday_thu'), t('weekday_fri'), t('weekday_sat')];

  // Scroll to hash on mount or hash change
  useEffect(() => {
    if (location.hash === '#rules') {
      const element = document.getElementById('rules');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  }, [location]);

  // Helper to render a single month calendar
  const renderCalendar = (monthDate: Date) => {
    const start = startOfMonth(monthDate);
    const end = endOfMonth(monthDate);
    const days = eachDayOfInterval({ start, end });
    const startDayOfWeek = start.getDay(); // 0 for Sunday
    const padding = Array(startDayOfWeek).fill(null);

    return (
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
        <h3 className="text-center font-bold text-gray-900 mb-6 text-lg">{format(monthDate, 'MMMM yyyy', { locale: dateLocale })}</h3>
        <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-gray-400 mb-4 uppercase tracking-wider">
          {weekdayLabels.map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-2">
          {padding.map((_, i) => <div key={`pad-${i}`} />)}
          {days.map((day) => {
            const blocked = isDateBlocked(day);
            return (
              <div 
                key={day.toISOString()}
                className={`
                  aspect-square flex flex-col items-center justify-center rounded-lg text-sm font-medium relative transition-all duration-200
                  ${blocked 
                    ? 'bg-gray-50 text-gray-300 decoration-gray-300 line-through cursor-not-allowed' 
                    : 'bg-white text-gray-700 hover:bg-blue-600 hover:text-white hover:shadow-md hover:scale-105 cursor-pointer ring-1 ring-gray-100 hover:ring-blue-600'
                  }
                `}
              >
                <span>{format(day, 'd')}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Helper to find cleaning fee for a specific guest count
  const getCleaningFee = (guestCount: number) => {
      const tier = data.pricing.cleaning.find(c => guestCount >= c.minGuests && guestCount <= c.maxGuests);
      return tier ? tier.price : 0;
  };

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-8">
      <div className="text-center mb-8">
        <h1 className="text-[22px] md:text-[28px] font-bold text-gray-900 leading-[1.25] mb-2">{data.titles.pricing}</h1>
        <p className="text-[14px] md:text-[16px] text-gray-500 leading-[1.6]">{data.titles.pricingSubtitle}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Simulator (Mobile) & Rules */}
          <div className="lg:col-span-7 space-y-8">
             {/* Mobile Only: Show Simulator here */}
            <div className="block lg:hidden">
                <BookingWidget
                    pricing={data.pricing}
                    adminEmail={data.adminEmail}
                    propertyId={data.id}
                    directBooking={data.directBooking}
                />
            </div>

            {/* Pricing Rules Section */}
            <div id="rules" className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 overflow-hidden">
                <div className="p-8 bg-gradient-to-br from-blue-50 to-white border-b border-blue-50">
                    <h3 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                        <Tag className="w-5 h-5 text-blue-600"/> {t('price_rates')}
                    </h3>
                    <p className="text-gray-500 text-sm mt-1">{t('price_rates_desc')}</p>
                </div>

                <div className="p-0">
                    <table className="w-full text-sm text-left">
                        <thead className="bg-gray-50 text-gray-500 font-medium uppercase text-xs">
                            <tr>
                                <th className="px-6 py-4">{t('price_table_guests')}</th>
                                <th className="px-6 py-4">{t('price_table_price_guest')}</th>
                                <th className="px-6 py-4 text-right">{t('price_table_cleaning')}</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {data.pricing.rates.map((rate, index) => (
                                <tr key={index} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900">{rate.guests} {rate.guests > 1 ? t('price_guests') : t('price_guest')}</td>
                                    <td className="px-6 py-4 text-gray-600">¥{rate.price.toLocaleString()} {t('price_per_night')}</td>
                                    <td className="px-6 py-4 text-right text-gray-600">¥{getCleaningFee(rate.guests).toLocaleString()}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                <div className="p-6 bg-gray-50 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Sparkles className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="block font-bold text-gray-900 text-sm">{t('price_long_stay')}</span>
                            <span className="text-xs text-gray-500">
                                {t('price_long_stay_desc')
                                    .replace('{percent}', String(data.pricing.longStayDiscountPercent))
                                    .replace('{nights}', String(data.pricing.longStayMinNights))}
                            </span>
                        </div>
                     </div>
                     <div className="flex items-start gap-3 p-3 bg-white rounded-xl border border-gray-100 shadow-sm">
                        <div className="p-2 bg-blue-100 text-blue-600 rounded-lg">
                            <Info className="w-4 h-4" />
                        </div>
                        <div>
                            <span className="block font-bold text-gray-900 text-sm">{t('price_children_discount')}</span>
                            <span className="text-xs text-gray-500">
                                {t('price_children_discount_desc')
                                    .replace('{min}', String(data.pricing.childAgeMin))
                                    .replace('{max}', String(data.pricing.childAgeMax))
                                    .replace('{percent}', String(data.pricing.childDiscountPercent))}
                            </span>
                        </div>
                     </div>
                </div>
            </div>
          </div>

          {/* Right Column: Calendar */}
          <div className="lg:col-span-5 space-y-8">
               <div className="flex items-center justify-between lg:justify-start gap-4 mb-2">
                   <h2 className="text-2xl font-bold text-gray-900">{t('price_avail')}</h2>
                   <div className="flex items-center gap-2 text-xs font-medium bg-gray-100 px-3 py-1 rounded-full text-gray-600">
                      <span className="w-2 h-2 rounded-full bg-gray-300"></span> {t('price_blocked')}
                      <span className="w-2 h-2 rounded-full bg-blue-600 ml-2"></span> {t('price_available')}
                   </div>
               </div>

               <div className="space-y-6">
                 {renderCalendar(currentMonth)}
                 {renderCalendar(addMonths(currentMonth, 1))}
               </div>

               <div className="flex justify-center gap-4 pt-2">
                    <button onClick={() => setCurrentMonth(addMonths(currentMonth, -1))} className="px-5 py-2.5 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 rounded-xl text-sm font-semibold transition-all">{t('price_prev')}</button>
                    <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="px-5 py-2.5 bg-white border border-gray-200 shadow-sm hover:bg-gray-50 rounded-xl text-sm font-semibold transition-all">{t('price_next')}</button>
               </div>
          </div>
      </div>
    </div>
  );
};

export default PricingPage;
