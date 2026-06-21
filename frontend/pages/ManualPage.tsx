import React, { useState } from 'react';
import { PropertyData } from '../types';
import { ChevronDown, ChevronUp, BookOpen, Search } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

interface ManualPageProps {
  data: PropertyData;
}

const ManualPage: React.FC<ManualPageProps> = ({ data }) => {
  const { t } = useLanguage();
  const [openId, setOpenId] = useState<string | null>(data.manual[0]?.id || null);
  const [search, setSearch] = useState('');

  const filteredManual = data.manual.filter(item => 
    item.title.toLowerCase().includes(search.toLowerCase()) || 
    item.content.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
              <div>
                  <h1 className="text-[22px] md:text-[28px] font-bold text-gray-900 leading-[1.25] mb-2">{data.titles.manual}</h1>
                  <p className="text-[14px] md:text-[16px] text-gray-500 leading-[1.6]">{data.titles.manualSubtitle}</p>
            </div>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input
                    type="text"
                    placeholder={t('manual_search_placeholder')}
                    className="pl-10 pr-4 py-2 border border-gray-200 rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full md:w-64 bg-white text-gray-900"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
            </div>
        </div>

        <div className="space-y-4">
            {filteredManual.length > 0 ? (
                filteredManual.map((item) => {
                    const isOpen = openId === item.id;
                    return (
                        <div key={item.id} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
                            <button 
                                onClick={() => setOpenId(isOpen ? null : item.id)}
                                className="w-full flex items-center justify-between p-6 text-left bg-white hover:bg-gray-50 transition-colors"
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`p-2 rounded-lg ${isOpen ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}`}>
                                        <BookOpen className="w-5 h-5" />
                                    </div>
                                    <span className="font-bold text-gray-900 text-lg">{item.title}</span>
                                </div>
                                {isOpen ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                            </button>
                            
                            {isOpen && (
                                <div className="p-6 pt-0 bg-white border-t border-gray-100">
                                    {item.imageUrl && (
                                        <div className="mt-6 mb-6 rounded-lg overflow-hidden border border-gray-100 shadow-sm bg-gray-50 max-w-xl">
                                            <img 
                                                src={item.imageUrl} 
                                                alt={item.title} 
                                                className="w-full h-auto object-cover max-h-[400px]"
                                            />
                                        </div>
                                    )}
                                    <p className="text-gray-600 leading-relaxed whitespace-pre-line mt-4">
                                        {item.content}
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })
            ) : (
                <div className="text-center py-12 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                    <p className="text-gray-500">{t('manual_no_results').replace('{search}', search)}</p>
                </div>
            )}
        </div>
    </div>
  );
};

export default ManualPage;