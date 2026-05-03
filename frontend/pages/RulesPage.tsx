import React from 'react';
import { PropertyData } from '../types';
import { CigaretteOff, PartyPopper, Moon, Footprints, AlertCircle, CheckCircle } from 'lucide-react';

interface RulesPageProps {
  data: PropertyData;
}

const iconMap: Record<string, React.ElementType> = {
  CigaretteOff,
  PartyPopper,
  Moon,
  Footprints,
};

const RulesPage: React.FC<RulesPageProps> = ({ data }) => {
  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 lg:px-8 py-8">
       <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{data.titles.rules}</h1>
        <p className="text-gray-500">{data.titles.rulesSubtitle}</p>
      </div>

      <div className="space-y-6">
          {data.rules.map((rule) => {
              const Icon = iconMap[rule.icon] || AlertCircle;
              return (
                  <div key={rule.id} className="bg-white border border-gray-100 shadow-sm rounded-xl p-6 flex items-start gap-6 transition-all hover:shadow-md">
                      <div className={`
                          p-4 rounded-full flex-shrink-0
                          ${rule.type === 'forbidden' ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}
                      `}>
                          <Icon className="w-6 h-6" />
                      </div>
                      <div>
                          <h3 className="text-lg font-bold text-gray-900 mb-1">
                              {rule.text}
                          </h3>
                          <p className="text-gray-500 text-sm">
                              {rule.type === 'forbidden' ? 'Strictly prohibited in the property.' : 'We appreciate your cooperation.'}
                          </p>
                      </div>
                      <div className="ml-auto">
                           {rule.type === 'forbidden' ? (
                               <div className="w-2 h-2 rounded-full bg-red-400 mt-2"></div>
                           ) : (
                                <div className="w-2 h-2 rounded-full bg-green-400 mt-2"></div>
                           )}
                      </div>
                  </div>
              )
          })}
      </div>

      <div className="mt-8 bg-gray-50 border border-gray-200 rounded-xl p-6">
          <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-gray-600"/> Additional Notes
          </h3>
          <p className="text-gray-600 text-sm whitespace-pre-line leading-relaxed">
             {data.additionalRules}
          </p>
      </div>
    </div>
  );
};

export default RulesPage;