
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { PropertyData, PricingConfig, ICalFeed, HouseRule, ManualItem, SleepingArrangement, HighlightItem, AccessInfo, PricingTier, CleaningTier, SocialInfo, PropertyTitles, GalleryItem, GalleryCategoryDef } from '../types';
import { savePropertyData } from '../services/storage';
import { checkAuth, logout } from '../services/auth';
import { 
  Save, Plus, Trash2, Lock, LayoutDashboard, DollarSign, Calendar, 
  FileText, BookOpen, List, Map, CigaretteOff, PartyPopper, Moon, 
  Footprints, Wifi, Dog, Music, Utensils, CheckCircle, AlertCircle, Image as ImageIcon,
  BedDouble, Info, Monitor, Wind, Coffee, Star, X, ThumbsUp,
  Tv, Car, Waves, Dumbbell, Flame, Sun, Bath, Thermometer, 
  ShieldCheck, Key, Shirt, Briefcase, Lock as LockIcon, Mail, LogOut, Loader2, Shield,
  Eye, EyeOff, Type, Globe, Refrigerator, Microwave, ShowerHead, Zap, Medal, Palette,
  Settings, FolderOpen, Home, Github, Cloud, CloudRain, LockKeyhole, Share2
} from 'lucide-react';

interface AdminPageProps {
  data: PropertyData;
  onUpdate: (newData: PropertyData) => void;
}

type SupportedCountryCode = 'JP' | 'VN';

interface ProvinceOption {
    code: string;
    name: string;
}

const COUNTRY_OPTIONS: Array<{ code: SupportedCountryCode; name: string }> = [
    { code: 'JP', name: 'Japan' },
    { code: 'VN', name: 'Vietnam' },
];

const PROVINCES_BY_COUNTRY: Record<SupportedCountryCode, ProvinceOption[]> = {
    JP: [
        { code: 'JP-AICHI', name: 'Aichi' },
        { code: 'JP-AKITA', name: 'Akita' },
        { code: 'JP-AOMORI', name: 'Aomori' },
        { code: 'JP-CHIBA', name: 'Chiba' },
        { code: 'JP-EHIME', name: 'Ehime' },
        { code: 'JP-FUKUI', name: 'Fukui' },
        { code: 'JP-FUKUOKA', name: 'Fukuoka' },
        { code: 'JP-FUKUSHIMA', name: 'Fukushima' },
        { code: 'JP-GIFU', name: 'Gifu' },
        { code: 'JP-GUNMA', name: 'Gunma' },
        { code: 'JP-HIROSHIMA', name: 'Hiroshima' },
        { code: 'JP-HOKKAIDO', name: 'Hokkaido' },
        { code: 'JP-HYOGO', name: 'Hyogo' },
        { code: 'JP-IBARAKI', name: 'Ibaraki' },
        { code: 'JP-ISHIKAWA', name: 'Ishikawa' },
        { code: 'JP-IWATE', name: 'Iwate' },
        { code: 'JP-KAGAWA', name: 'Kagawa' },
        { code: 'JP-KAGOSHIMA', name: 'Kagoshima' },
        { code: 'JP-KANAGAWA', name: 'Kanagawa' },
        { code: 'JP-KOCHI', name: 'Kochi' },
        { code: 'JP-KUMAMOTO', name: 'Kumamoto' },
        { code: 'JP-KYOTO', name: 'Kyoto' },
        { code: 'JP-MIE', name: 'Mie' },
        { code: 'JP-MIYAGI', name: 'Miyagi' },
        { code: 'JP-MIYAZAKI', name: 'Miyazaki' },
        { code: 'JP-NAGANO', name: 'Nagano' },
        { code: 'JP-NAGASAKI', name: 'Nagasaki' },
        { code: 'JP-NARA', name: 'Nara' },
        { code: 'JP-NIIGATA', name: 'Niigata' },
        { code: 'JP-OITA', name: 'Oita' },
        { code: 'JP-OKAYAMA', name: 'Okayama' },
        { code: 'JP-OKINAWA', name: 'Okinawa' },
        { code: 'JP-OSAKA', name: 'Osaka' },
        { code: 'JP-SAGA', name: 'Saga' },
        { code: 'JP-SAITAMA', name: 'Saitama' },
        { code: 'JP-SHIGA', name: 'Shiga' },
        { code: 'JP-SHIMANE', name: 'Shimane' },
        { code: 'JP-SHIZUOKA', name: 'Shizuoka' },
        { code: 'JP-TOCHIGI', name: 'Tochigi' },
        { code: 'JP-TOKUSHIMA', name: 'Tokushima' },
        { code: 'JP-TOKYO', name: 'Tokyo' },
        { code: 'JP-TOTTORI', name: 'Tottori' },
        { code: 'JP-TOYAMA', name: 'Toyama' },
        { code: 'JP-WAKAYAMA', name: 'Wakayama' },
        { code: 'JP-YAMAGATA', name: 'Yamagata' },
        { code: 'JP-YAMAGUCHI', name: 'Yamaguchi' },
        { code: 'JP-YAMANASHI', name: 'Yamanashi' },
    ],
    VN: [
        { code: 'VN-AN-GIANG', name: 'An Giang' },
        { code: 'VN-BA-RIA-VUNG-TAU', name: 'Ba Ria - Vung Tau' },
        { code: 'VN-BAC-GIANG', name: 'Bac Giang' },
        { code: 'VN-BAC-KAN', name: 'Bac Kan' },
        { code: 'VN-BAC-LIEU', name: 'Bac Lieu' },
        { code: 'VN-BAC-NINH', name: 'Bac Ninh' },
        { code: 'VN-BEN-TRE', name: 'Ben Tre' },
        { code: 'VN-BINH-DINH', name: 'Binh Dinh' },
        { code: 'VN-BINH-DUONG', name: 'Binh Duong' },
        { code: 'VN-BINH-PHUOC', name: 'Binh Phuoc' },
        { code: 'VN-BINH-THUAN', name: 'Binh Thuan' },
        { code: 'VN-CA-MAU', name: 'Ca Mau' },
        { code: 'VN-CAN-THO', name: 'Can Tho' },
        { code: 'VN-CAO-BANG', name: 'Cao Bang' },
        { code: 'VN-DA-NANG', name: 'Da Nang' },
        { code: 'VN-DAK-LAK', name: 'Dak Lak' },
        { code: 'VN-DAK-NONG', name: 'Dak Nong' },
        { code: 'VN-DIEN-BIEN', name: 'Dien Bien' },
        { code: 'VN-DONG-NAI', name: 'Dong Nai' },
        { code: 'VN-DONG-THAP', name: 'Dong Thap' },
        { code: 'VN-GIA-LAI', name: 'Gia Lai' },
        { code: 'VN-HA-GIANG', name: 'Ha Giang' },
        { code: 'VN-HA-NAM', name: 'Ha Nam' },
        { code: 'VN-HA-NOI', name: 'Ha Noi' },
        { code: 'VN-HA-TINH', name: 'Ha Tinh' },
        { code: 'VN-HAI-DUONG', name: 'Hai Duong' },
        { code: 'VN-HAI-PHONG', name: 'Hai Phong' },
        { code: 'VN-HAU-GIANG', name: 'Hau Giang' },
        { code: 'VN-HOA-BINH', name: 'Hoa Binh' },
        { code: 'VN-HO-CHI-MINH-CITY', name: 'Ho Chi Minh City' },
        { code: 'VN-HUNG-YEN', name: 'Hung Yen' },
        { code: 'VN-KHANH-HOA', name: 'Khanh Hoa' },
        { code: 'VN-KIEN-GIANG', name: 'Kien Giang' },
        { code: 'VN-KON-TUM', name: 'Kon Tum' },
        { code: 'VN-LAI-CHAU', name: 'Lai Chau' },
        { code: 'VN-LAM-DONG', name: 'Lam Dong' },
        { code: 'VN-LANG-SON', name: 'Lang Son' },
        { code: 'VN-LAO-CAI', name: 'Lao Cai' },
        { code: 'VN-LONG-AN', name: 'Long An' },
        { code: 'VN-NAM-DINH', name: 'Nam Dinh' },
        { code: 'VN-NGHE-AN', name: 'Nghe An' },
        { code: 'VN-NINH-BINH', name: 'Ninh Binh' },
        { code: 'VN-NINH-THUAN', name: 'Ninh Thuan' },
        { code: 'VN-PHU-THO', name: 'Phu Tho' },
        { code: 'VN-PHU-YEN', name: 'Phu Yen' },
        { code: 'VN-QUANG-BINH', name: 'Quang Binh' },
        { code: 'VN-QUANG-NAM', name: 'Quang Nam' },
        { code: 'VN-QUANG-NGAI', name: 'Quang Ngai' },
        { code: 'VN-QUANG-NINH', name: 'Quang Ninh' },
        { code: 'VN-QUANG-TRI', name: 'Quang Tri' },
        { code: 'VN-SOC-TRANG', name: 'Soc Trang' },
        { code: 'VN-SON-LA', name: 'Son La' },
        { code: 'VN-TAY-NINH', name: 'Tay Ninh' },
        { code: 'VN-THAI-BINH', name: 'Thai Binh' },
        { code: 'VN-THAI-NGUYEN', name: 'Thai Nguyen' },
        { code: 'VN-THANH-HOA', name: 'Thanh Hoa' },
        { code: 'VN-THUA-THIEN-HUE', name: 'Thua Thien Hue' },
        { code: 'VN-TIEN-GIANG', name: 'Tien Giang' },
        { code: 'VN-TRA-VINH', name: 'Tra Vinh' },
        { code: 'VN-TUYEN-QUANG', name: 'Tuyen Quang' },
        { code: 'VN-VINH-LONG', name: 'Vinh Long' },
        { code: 'VN-VINH-PHUC', name: 'Vinh Phuc' },
        { code: 'VN-YEN-BAI', name: 'Yen Bai' },
    ],
};

function buildAddressFromParts(countryName: string, provinceName: string, detail?: string): string {
    const detailPart = (detail || '').trim();
    if (detailPart) {
        return `${detailPart}, ${provinceName}, ${countryName}`;
    }
    return `${provinceName}, ${countryName}`;
}

function inferLocationFromAddress(address: string): PropertyData['location'] {
    const normalizedAddress = (address || '').toLowerCase();
    if (!normalizedAddress) {
        return undefined;
    }

    for (const country of COUNTRY_OPTIONS) {
        const countryNameLower = country.name.toLowerCase();
        if (!normalizedAddress.includes(countryNameLower)) {
            continue;
        }

        const provinces = PROVINCES_BY_COUNTRY[country.code];
        const provinceMatch = provinces.find((province) => normalizedAddress.includes(province.name.toLowerCase()));
        if (!provinceMatch) {
            continue;
        }

        return {
            countryCode: country.code,
            countryName: country.name,
            provinceCode: provinceMatch.code,
            provinceName: provinceMatch.name,
        };
    }

    return undefined;
}

const ICON_OPTIONS = [
  { value: 'CigaretteOff', label: 'No Smoking' },
  { value: 'PartyPopper', label: 'No Parties' },
  { value: 'Moon', label: 'Quiet Hours' },
  { value: 'Footprints', label: 'No Shoes' },
  { value: 'Wifi', label: 'Wifi' },
  { value: 'Dog', label: 'Pets' },
  { value: 'Music', label: 'Music' },
  { value: 'Utensils', label: 'Food' },
  { value: 'CheckCircle', label: 'Check Mark' },
  { value: 'AlertCircle', label: 'Alert' },
];

const HIGHLIGHT_ICON_OPTIONS = [
    { value: 'Monitor', label: 'Workspace' },
    { value: 'Wind', label: 'AC/Heat' },
    { value: 'Wifi', label: 'Wifi' },
    { value: 'Coffee', label: 'Coffee' },
    { value: 'CheckCircle', label: 'Check' },
];

const AMENITY_CATEGORIES = [
  {
    title: 'Essentials',
    items: [
      { name: 'Wifi', icon: Wifi },
      { name: 'TV', icon: Tv },
      { name: 'Washing Machine', icon: Waves },
      { name: 'Air conditioning', icon: Wind },
      { name: 'Heating', icon: Thermometer },
      { name: 'Workspace', icon: Monitor },
      { name: 'Hair dryer', icon: Wind },
      { name: 'Iron', icon: Shirt },
      { name: 'Steamer', icon: Shirt }, // Garment steamer
      { name: 'Essentials', icon: Key }, // Towels, bed sheets, soap, toilet paper
    ]
  },
  {
    title: 'Kitchen & Dining',
    items: [
      { name: 'Kitchen', icon: Utensils },
      { name: 'Refrigerator', icon: Refrigerator },
      { name: 'Microwave', icon: Microwave },
      { name: 'Rice cooker', icon: Utensils },
      { name: 'Electric kettle', icon: Coffee }, // or Zap
      { name: 'Coffee maker', icon: Coffee },
      { name: 'Dishes and silverware', icon: Utensils },
    ]
  },
  {
    title: 'Bathroom',
    items: [
      { name: 'Shower', icon: ShowerHead },
      { name: 'Bathtub', icon: Bath },
      { name: 'Hot water', icon: Thermometer },
      { name: 'Shampoo', icon: Waves },
    ]
  },
  {
    title: 'Features',
    items: [
      { name: 'Self check-in', icon: Key },
      { name: 'Free parking', icon: Car },
      { name: 'Patio', icon: Sun },
      { name: 'BBQ grill', icon: Flame },
      { name: 'Gym', icon: Dumbbell },
      { name: 'Piano', icon: Music },
    ]
  },
  {
    title: 'Safety',
    items: [
      { name: 'Smoke alarm', icon: ShieldCheck },
      { name: 'Fire extinguisher', icon: Flame },
      { name: 'First aid kit', icon: Briefcase },
      { name: 'Lock on bedroom door', icon: LockIcon },
    ]
  }
];

const AdminPage: React.FC<AdminPageProps> = ({ data, onUpdate }) => {
    const navigate = useNavigate();
    const { pathname, search } = useLocation();
  const { id } = useParams<{ id: string }>();
  const propertyId = data.id || id || 'main';

  // Initialize auth state from localStorage
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(checkAuth());
  const [errorMsg, setErrorMsg] = useState('');
  
  const [formData, setFormData] = useState<PropertyData>(data);
  const [activeTab, setActiveTab] = useState<'general' | 'pricing' | 'ical' | 'amenities' | 'rules' | 'manual' | 'gallery' | 'rooms' | 'highlights' | 'access' | 'labels'>('general');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [saveMessage, setSaveMessage] = useState('');
  const [customAmenity, setCustomAmenity] = useState('');

  // Category Management State
  const [isManagingCategories, setIsManagingCategories] = useState(false);
  const [newCategoryLabel, setNewCategoryLabel] = useState('');

    useEffect(() => {
                const inferredLocation = data.location ?? inferLocationFromAddress(data.address || '');
                setFormData({
                    ...data,
                    location: inferredLocation,
                });
    }, [data]);

    const handleLogin = () => {
    setErrorMsg('');
        navigate(`/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  const handleLogout = async () => {
    await logout();
    setIsAuthenticated(false);
  };

  const handleSave = async () => {
        const countryCode = formData.location?.countryCode as SupportedCountryCode | undefined;
        const countryName = formData.location?.countryName || '';
        const provinceCode = formData.location?.provinceCode || '';
        const provinceName = formData.location?.provinceName || '';

        if (!countryCode || !countryName || !provinceCode || !provinceName) {
            setSaveStatus('error');
            setSaveMessage('Please choose Country and Province in Access Information.');
            setActiveTab('access');
            return;
        }

    setSaveStatus('saving');
    setSaveMessage('');
    
    // Prepare data to save
    const dataToSave = { ...formData };
    
    if (dataToSave.metalink) {
      // sanitize metalink
      dataToSave.metalink = dataToSave.metalink.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
        dataToSave.address = buildAddressFromParts(countryName, provinceName, formData.location?.cityName);

    setFormData(dataToSave); // Update state

    try {
      await savePropertyData(dataToSave, propertyId);
      onUpdate(dataToSave);
      setSaveStatus('saved');
            setSaveMessage('Saved successfully.');
    } catch (error) {
      setSaveStatus('error');
            setSaveMessage(error instanceof Error ? error.message : 'Failed to save property.');
    }

    // Reset status after a delay
    setTimeout(() => {
        setSaveStatus('idle');
        setSaveMessage('');
    }, 4000);
  };

  const handleChange = (field: keyof PropertyData, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

    const selectedCountryCode = formData.location?.countryCode as SupportedCountryCode | undefined;
    const selectedProvinceCode = formData.location?.provinceCode || '';
    const provinceOptions = selectedCountryCode
        ? [...PROVINCES_BY_COUNTRY[selectedCountryCode]].sort((left, right) => left.name.localeCompare(right.name))
        : [];

    const handleCountrySelect = (countryCodeValue: string) => {
        const country = COUNTRY_OPTIONS.find((option) => option.code === countryCodeValue);
        if (!country) {
            setFormData((prev) => ({
                ...prev,
                location: undefined,
                address: '',
            }));
            return;
        }

        setFormData((prev) => ({
            ...prev,
            location: {
                countryCode: country.code,
                countryName: country.name,
                provinceCode: '',
                provinceName: '',
                cityName: prev.location?.cityName || '',
            },
            address: '',
        }));
    };

    const handleProvinceSelect = (provinceCodeValue: string) => {
        if (!selectedCountryCode) {
            return;
        }
        const country = COUNTRY_OPTIONS.find((option) => option.code === selectedCountryCode);
        const province = PROVINCES_BY_COUNTRY[selectedCountryCode].find((item) => item.code === provinceCodeValue);

        if (!country || !province) {
            setFormData((prev) => ({
                ...prev,
                location: {
                    countryCode: selectedCountryCode,
                    countryName: country?.name || '',
                    provinceCode: '',
                    provinceName: '',
                    cityName: prev.location?.cityName || '',
                },
                address: '',
            }));
            return;
        }

        setFormData((prev) => {
            const detail = prev.location?.cityName || '';
            return {
                ...prev,
                location: {
                    countryCode: selectedCountryCode,
                    countryName: country.name,
                    provinceCode: province.code,
                    provinceName: province.name,
                    cityName: detail,
                },
                address: buildAddressFromParts(country.name, province.name, detail),
            };
        });
    };

    const handleAddressDetailChange = (detailValue: string) => {
        setFormData((prev) => {
            const countryName = prev.location?.countryName || '';
            const provinceName = prev.location?.provinceName || '';
            return {
                ...prev,
                location: prev.location
                    ? {
                        ...prev.location,
                        cityName: detailValue,
                    }
                    : prev.location,
                address: countryName && provinceName
                    ? buildAddressFromParts(countryName, provinceName, detailValue)
                    : prev.address,
            };
        });
    };
  
  // ... (Other handlers unchanged) ...
  const handleAccessChange = (field: keyof AccessInfo, value: string) => {
      setFormData(prev => ({
          ...prev,
          accessInfo: { ...prev.accessInfo, [field]: value }
      }));
  };

  const handleSocialChange = (field: keyof SocialInfo, value: string) => {
      setFormData(prev => ({
          ...prev,
          social: { ...prev.social, [field]: value }
      }));
  };
  
  const handleTitleChange = (field: keyof PropertyTitles, value: string) => {
      setFormData(prev => ({
          ...prev,
          titles: { ...prev.titles, [field]: value }
      }));
  };
  
  // Pricing Logic
  const addRateTier = () => {
      const newTier: PricingTier = { guests: 1, price: 5000 };
      setFormData(prev => ({
          ...prev,
          pricing: { ...prev.pricing, rates: [...prev.pricing.rates, newTier] }
      }));
  };
  
  const updateRateTier = (index: number, field: keyof PricingTier, value: number) => {
      const newRates = [...formData.pricing.rates];
      newRates[index] = { ...newRates[index], [field]: value };
      newRates.sort((a, b) => a.guests - b.guests);
      setFormData(prev => ({ ...prev, pricing: { ...prev.pricing, rates: newRates } }));
  };

  const removeRateTier = (index: number) => {
      const newRates = [...formData.pricing.rates];
      newRates.splice(index, 1);
      setFormData(prev => ({ ...prev, pricing: { ...prev.pricing, rates: newRates } }));
  };

  const addCleaningTier = () => {
    const newTier: CleaningTier = { minGuests: 1, maxGuests: 1, price: 5000 };
    setFormData(prev => ({
        ...prev,
        pricing: { ...prev.pricing, cleaning: [...prev.pricing.cleaning, newTier] }
    }));
  };

  const updateCleaningTier = (index: number, field: keyof CleaningTier, value: number) => {
    const newCleaning = [...formData.pricing.cleaning];
    newCleaning[index] = { ...newCleaning[index], [field]: value };
    setFormData(prev => ({ ...prev, pricing: { ...prev.pricing, cleaning: newCleaning } }));
  };

  const removeCleaningTier = (index: number) => {
    const newCleaning = [...formData.pricing.cleaning];
    newCleaning.splice(index, 1);
    setFormData(prev => ({ ...prev, pricing: { ...prev.pricing, cleaning: newCleaning } }));
  };

  const updateDiscount = (field: keyof PricingConfig, value: number) => {
      setFormData(prev => ({
          ...prev,
          pricing: { ...prev.pricing, [field]: value }
      }));
  };

  // iCal Handlers
  const addIcal = () => {
    const newFeed: ICalFeed = {
        id: Date.now().toString(),
        name: 'New Calendar',
        url: '',
        lastSynced: new Date().toISOString()
    };
    setFormData(prev => ({ ...prev, icalFeeds: [...prev.icalFeeds, newFeed] }));
  };

  const updateIcal = (id: string, field: keyof ICalFeed, value: string) => {
      setFormData(prev => ({
          ...prev,
          icalFeeds: prev.icalFeeds.map(f => f.id === id ? { ...f, [field]: value } : f)
      }));
  };

  const removeIcal = (id: string) => {
      setFormData(prev => ({ ...prev, icalFeeds: prev.icalFeeds.filter(f => f.id !== id) }));
  };

  // Amenities Handlers
  const toggleAmenity = (name: string) => {
    const current = formData.amenities || [];
    if (current.includes(name)) {
      setFormData(prev => ({ ...prev, amenities: current.filter(item => item !== name) }));
    } else {
      setFormData(prev => ({ ...prev, amenities: [...current, name] }));
    }
  };

  const addCustomAmenity = () => {
    if (customAmenity && !formData.amenities.includes(customAmenity)) {
       setFormData(prev => ({ ...prev, amenities: [...prev.amenities, customAmenity] }));
       setCustomAmenity('');
    }
  };

  const removeAmenityByName = (name: string) => {
      setFormData(prev => ({ ...prev, amenities: prev.amenities.filter(item => item !== name) }));
  };

  // Rules Handlers
  const addRule = () => {
    const newRule: HouseRule = {
      id: Date.now().toString(),
      text: '',
      icon: 'CheckCircle',
      type: 'allowed'
    };
    setFormData(prev => ({ ...prev, rules: [...prev.rules, newRule] }));
  };

  const updateRule = (id: string, field: keyof HouseRule, value: any) => {
    setFormData(prev => ({
      ...prev,
      rules: prev.rules.map(r => r.id === id ? { ...r, [field]: value } : r)
    }));
  };

  const removeRule = (id: string) => {
    setFormData(prev => ({ ...prev, rules: prev.rules.filter(r => r.id !== id) }));
  };

  // Highlights Handlers
  const addHighlight = () => {
    const newHighlight: HighlightItem = {
      id: Date.now().toString(),
      title: 'New Highlight',
      description: '',
      icon: 'Monitor'
    };
    setFormData(prev => ({ ...prev, highlights: [...(prev.highlights || []), newHighlight] }));
  };

  const updateHighlight = (id: string, field: keyof HighlightItem, value: any) => {
    setFormData(prev => ({
      ...prev,
      highlights: (prev.highlights || []).map(h => h.id === id ? { ...h, [field]: value } : h)
    }));
  };

  const removeHighlight = (id: string) => {
    setFormData(prev => ({ ...prev, highlights: (prev.highlights || []).filter(h => h.id !== id) }));
  };

  // Manual Handlers
  const addManualItem = () => {
    const newItem: ManualItem = {
      id: Date.now().toString(),
      title: 'New Guide',
      content: ''
    };
    setFormData(prev => ({ ...prev, manual: [...prev.manual, newItem] }));
  };

  const updateManualItem = (id: string, field: keyof ManualItem, value: string) => {
    setFormData(prev => ({
      ...prev,
      manual: prev.manual.map(m => m.id === id ? { ...m, [field]: value } : m)
    }));
  };

  const removeManualItem = (id: string) => {
    setFormData(prev => ({ ...prev, manual: prev.manual.filter(m => m.id !== id) }));
  };

  // Gallery Handlers
  const addImage = () => {
    const newItem: GalleryItem = {
        id: Date.now().toString(),
        url: "",
        caption: "New Photo",
        category: 'other',
        showOnHome: false
    };
    const newImages = formData.galleryImages ? [...formData.galleryImages, newItem] : [newItem];
    setFormData(prev => ({ ...prev, galleryImages: newImages }));
  };

  const updateImage = (index: number, field: keyof GalleryItem, value: any) => {
     const newImages = [...(formData.galleryImages || [])];
     newImages[index] = { ...newImages[index], [field]: value };
     setFormData(prev => ({ ...prev, galleryImages: newImages }));
  };

  const removeImage = (index: number) => {
     const newImages = [...(formData.galleryImages || [])];
     newImages.splice(index, 1);
     setFormData(prev => ({ ...prev, galleryImages: newImages }));
  };
  
  // Category Handlers
  const addCategory = () => {
      if (!newCategoryLabel.trim()) return;
      const id = newCategoryLabel.toLowerCase().replace(/[^a-z0-9]/g, '-');
      // prevent duplicate ids
      if (formData.galleryCategories.some(c => c.id === id)) {
          alert('A category with a similar name already exists.');
          return;
      }
      
      const newCat: GalleryCategoryDef = { id, label: newCategoryLabel };
      setFormData(prev => ({ ...prev, galleryCategories: [...prev.galleryCategories, newCat] }));
      setNewCategoryLabel('');
  };
  
  const removeCategory = (id: string) => {
      setFormData(prev => ({ ...prev, galleryCategories: prev.galleryCategories.filter(c => c.id !== id) }));
  };

  // Rooms / Sleeping Arrangements Handlers
  const addRoom = () => {
    const newRoom: SleepingArrangement = {
        id: Date.now().toString(),
        title: 'New Bedroom',
        description: '1 double bed',
        imageUrl: '',
        photos: []
    };
    const currentRooms = formData.sleepingArrangements || [];
    setFormData(prev => ({ ...prev, sleepingArrangements: [...currentRooms, newRoom] }));
  };

  const updateRoom = (id: string, field: keyof SleepingArrangement, value: any) => {
      const currentRooms = formData.sleepingArrangements || [];
      setFormData(prev => ({
          ...prev,
          sleepingArrangements: currentRooms.map(r => r.id === id ? { ...r, [field]: value } : r)
      }));
  };

  const addRoomPhoto = (roomId: string) => {
      const currentRooms = formData.sleepingArrangements || [];
      const updatedRooms = currentRooms.map(room => {
          if (room.id === roomId) {
              return { ...room, photos: [...(room.photos || []), ""] };
          }
          return room;
      });
      setFormData(prev => ({ ...prev, sleepingArrangements: updatedRooms }));
  };

  const updateRoomPhoto = (roomId: string, photoIndex: number, newValue: string) => {
      const currentRooms = formData.sleepingArrangements || [];
      const updatedRooms = currentRooms.map(room => {
          if (room.id === roomId) {
              const newPhotos = [...(room.photos || [])];
              newPhotos[photoIndex] = newValue;
              return { ...room, photos: newPhotos };
          }
          return room;
      });
      setFormData(prev => ({ ...prev, sleepingArrangements: updatedRooms }));
  };

  const removeRoomPhoto = (roomId: string, photoIndex: number) => {
      const currentRooms = formData.sleepingArrangements || [];
      const updatedRooms = currentRooms.map(room => {
          if (room.id === roomId) {
              const newPhotos = [...(room.photos || [])];
              newPhotos.splice(photoIndex, 1);
              return { ...room, photos: newPhotos };
          }
          return room;
      });
      setFormData(prev => ({ ...prev, sleepingArrangements: updatedRooms }));
  };

  const removeRoom = (id: string) => {
      const currentRooms = formData.sleepingArrangements || [];
      setFormData(prev => ({ ...prev, sleepingArrangements: currentRooms.filter(r => r.id !== id) }));
  };

  const NAV_ITEMS = [
      { id: 'general', label: 'General', icon: LayoutDashboard },
      { id: 'gallery', label: 'Gallery', icon: ImageIcon },
      { id: 'rooms', label: 'Rooms', icon: BedDouble },
      { id: 'highlights', label: 'Highlights', icon: Star },
      { id: 'access', label: 'Access', icon: Map },
      { id: 'pricing', label: 'Pricing', icon: DollarSign },
      { id: 'ical', label: 'iCal', icon: Calendar },
      { id: 'amenities', label: 'Amenities', icon: List },
      { id: 'rules', label: 'Rules', icon: FileText },
      { id: 'manual', label: 'Manual', icon: BookOpen },
      { id: 'labels', label: 'Text & Labels', icon: Type },
  ];


  if (!isAuthenticated) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-200 w-full max-w-md">
          <div className="flex justify-center mb-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
                <Lock className="w-6 h-6" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">Admin Access</h2>
          <div className="space-y-4">
            {errorMsg && <p className="text-red-500 text-sm text-center">{errorMsg}</p>}
            <button 
              onClick={handleLogin}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 text-base"
            >
                            Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-6 md:py-12">
      <div className="flex flex-col md:flex-row md:justify-between md:items-center gap-4 mb-6">
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">Content Manager</h1>
        <div className="flex gap-2 w-full md:w-auto">
            <button 
            onClick={handleLogout}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
            >
            <LogOut className="w-4 h-4" />
            Logout
            </button>
            <button 
            onClick={handleSave}
            disabled={saveStatus !== 'idle'}
            className={`
                flex-1 md:flex-none items-center justify-center gap-2 px-6 py-2.5 rounded-lg font-bold text-white transition-all flex
                ${saveStatus === 'saved' ? 'bg-green-500' : saveStatus === 'error' ? 'bg-red-500' : 'bg-gray-900 hover:bg-gray-800'}
            `}
            >
            {saveStatus === 'saving' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4" />}
            {saveStatus === 'idle' ? 'Save Changes' : saveStatus === 'saving' ? 'Saving...' : saveStatus === 'error' ? 'Error' : 'Saved!'}
            </button>
            
            {propertyId !== 'main' && (
              <button 
                onClick={async () => {
                  if (window.confirm('Are you sure you want to delete this listing? This will redirect you to the home page.')) {
                    try {
                      const { deletePropertyData } = await import('../services/storage');
                      await deletePropertyData(propertyId);
                      window.location.href = '/#/';
                    } catch (e) {
                      alert('Failed to delete listing.');
                    }
                  }
                }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 transition-all"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            )}
        </div>
      </div>
      
      {/* Error Message Display */}
      {saveMessage && (
          <div className={`mb-6 p-4 rounded-lg text-sm font-medium ${saveStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {saveMessage}
          </div>
      )}

      {/* Warning for Missing Session Password during Cloud Sync */}
      {formData.github?.enabled && !sessionPassword && (
          <div className="mb-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg flex items-start gap-3">
              <LockKeyhole className="w-5 h-5 text-yellow-600 mt-0.5" />
              <div>
                  <h4 className="font-bold text-yellow-800 text-sm">Security Session Expired</h4>
                  <p className="text-yellow-700 text-sm">
                      You refreshed the page. To securely encrypt/decrypt the cloud token, please <button onClick={handleLogout} className="underline font-bold">logout and login again</button>.
                  </p>
              </div>
          </div>
      )}

      {/* Mobile Navigation (Horizontal Scroll) */}
      <div className="lg:hidden mb-6 -mx-4 px-4 overflow-x-auto no-scrollbar flex gap-2 snap-x">
          {NAV_ITEMS.map((item) => (
              <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id as typeof activeTab)}
                  className={`
                      flex items-center gap-2 px-4 py-2 rounded-full whitespace-nowrap text-sm font-bold border snap-start transition-colors
                      ${activeTab === item.id 
                          ? 'bg-blue-600 text-white border-blue-600' 
                          : 'bg-white text-gray-600 border-gray-200'}
                  `}
              >
                  <item.icon className="w-4 h-4" />
                  {item.label}
              </button>
          ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Desktop Sidebar Navigation */}
        <div className="hidden lg:block lg:col-span-1 space-y-2 sticky top-24 h-fit">
            {NAV_ITEMS.map(item => (
                <button 
                  key={item.id}
                  onClick={() => setActiveTab(item.id as typeof activeTab)}
                  className={`w-full text-left px-4 py-3 rounded-lg flex items-center gap-3 font-medium transition-colors ${activeTab === item.id ? 'bg-blue-50 text-blue-600' : 'text-gray-600 hover:bg-gray-50'}`}
                >
                  <item.icon className="w-5 h-5" /> {item.label}
                </button>
            ))}
        </div>

        {/* Form Content */}
        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-xl shadow-sm p-4 md:p-8">
            {activeTab === 'general' && (
                <div className="space-y-6">
                    {/* ... (Existing General Content) ... */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                         <div className="md:col-span-2">
                            <label className="block text-sm font-bold text-gray-700 mb-2">Property Name</label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                value={formData.name}
                                onChange={(e) => handleChange('name', e.target.value)}
                            />
                        </div>

                        <div className="md:col-span-2 rounded-xl border border-gray-200 bg-gray-50 p-4">
                            <h4 className="mb-3 text-sm font-bold text-gray-700 uppercase tracking-wide">Property Capacity</h4>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Guests</label>
                                    <input
                                        type="number"
                                        min={1}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                        value={formData.maxGuests}
                                        onChange={(e) => handleChange('maxGuests', parseInt(e.target.value, 10) || 1)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Bedrooms</label>
                                    <input
                                        type="number"
                                        min={1}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                        value={formData.bedrooms}
                                        onChange={(e) => handleChange('bedrooms', parseInt(e.target.value, 10) || 1)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Beds</label>
                                    <input
                                        type="number"
                                        min={1}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                        value={formData.beds}
                                        onChange={(e) => handleChange('beds', parseInt(e.target.value, 10) || 1)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Bath/Shower</label>
                                    <input
                                        type="number"
                                        min={1}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                        value={formData.baths}
                                        onChange={(e) => handleChange('baths', parseInt(e.target.value, 10) || 1)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Toilets</label>
                                    <input
                                        type="number"
                                        min={0}
                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                        value={formData.toilets}
                                        onChange={(e) => handleChange('toilets', parseInt(e.target.value, 10) || 0)}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="md:col-span-2">
                            <label className="block text-sm font-bold text-gray-700 mb-2">Custom URL (Metalink)</label>
                            <div className="flex bg-gray-50 border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500">
                                <span className="px-4 py-2 bg-gray-100 text-gray-500 border-r border-gray-300 text-sm whitespace-nowrap">
                                    {(window.location.origin + window.location.pathname).replace(/\/$/, '')}/#/
                                </span>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 outline-none bg-white text-gray-900 text-sm"
                                    value={formData.metalink || ''}
                                    onChange={(e) => handleChange('metalink', e.target.value)}
                                    placeholder={propertyId}
                                />
                            </div>
                            <p className="text-xs text-gray-500 mt-1">Leave empty to use the system default ID. Use lowercase letters and hyphens only.</p>
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-bold text-gray-700 mb-2">Subtitle / Tagline</label>
                            <input 
                                type="text" 
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                value={formData.subtitle || ''}
                                onChange={(e) => handleChange('subtitle', e.target.value)}
                                placeholder="e.g. Superhost • Tokyo, Japan"
                            />
                        </div>

                        {/* Browser title is still per-property; favicon is now global in Edit Page Content */}
                        <div className="md:col-span-2 bg-blue-50 p-4 rounded-xl border border-blue-100">
                            <h4 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                                <Globe className="w-4 h-4"/> Browser Title
                            </h4>
                            <div>
                                <label className="block text-xs font-bold text-blue-700 mb-1">Website Browser Title</label>
                                <input 
                                    type="text" 
                                    className="w-full px-3 py-2 border border-blue-200 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.metaTitle || ''}
                                    onChange={(e) => handleChange('metaTitle', e.target.value)}
                                    placeholder="e.g. Sachi House | Tokyo Stay"
                                />
                                <p className="text-[10px] text-blue-500 mt-1">Shows on the browser tab for this property page.</p>
                            </div>
                        </div>
                        
                         {/* THEME SELECTOR */}
                         <div className="md:col-span-2 bg-gray-50 p-4 rounded-xl border border-gray-200">
                             <label className="block text-sm font-bold text-gray-700 mb-3 flex items-center gap-2">
                                 <Palette className="w-4 h-4"/> Color Theme
                             </label>
                             <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {[
                                    { id: 'blue', name: 'Facebook Blue', color: '#2563EB' },
                                    { id: 'airbnb', name: 'Airbnb Red', color: '#FF385C' },
                                    { id: 'booking', name: 'Booking Navy', color: '#003580' },
                                    { id: 'agoda', name: 'Agoda Teal', color: '#32a081' }
                                ].map(theme => (
                                    <button
                                        key={theme.id}
                                        onClick={() => handleChange('themeColor', theme.id)}
                                        className={`
                                            flex items-center gap-2 p-3 rounded-lg border transition-all
                                            ${formData.themeColor === theme.id 
                                                ? 'bg-white border-blue-500 ring-2 ring-blue-500 ring-offset-1' 
                                                : 'bg-white border-gray-200 hover:bg-gray-50'}
                                        `}
                                    >
                                        <div className="w-6 h-6 rounded-full shrink-0" style={{ backgroundColor: theme.color }}></div>
                                        <span className="text-sm font-medium text-gray-700">{theme.name}</span>
                                    </button>
                                ))}
                             </div>
                             <p className="text-xs text-gray-500 mt-2 ml-1">Changes the primary color of buttons, links, and icons across the site.</p>
                         </div>

                         <div className="md:col-span-2">
                            <label className="block text-sm font-bold text-gray-700 mb-2">Description</label>
                            <textarea 
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-48 bg-white text-gray-900"
                                value={formData.description}
                                onChange={(e) => handleChange('description', e.target.value)}
                            />
                        </div>
                    </div>
                    
                    <div className="border-t border-gray-200 pt-6 mt-6">
                        <h3 className="font-bold text-gray-900 mb-4">Host Information</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Host Name</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.hostName || ''}
                                    onChange={(e) => handleChange('hostName', e.target.value)}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Host Image URL</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.hostImageUrl || ''}
                                    onChange={(e) => handleChange('hostImageUrl', e.target.value)}
                                />
                            </div>
                            
                            {/* NEW: Superhost Controls */}
                            <div className="flex items-center gap-3 bg-gray-50 p-3 rounded-lg border border-gray-200">
                                <input 
                                    type="checkbox"
                                    id="isSuperhost"
                                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    checked={!!formData.isSuperhost}
                                    onChange={(e) => handleChange('isSuperhost', e.target.checked)}
                                />
                                <label htmlFor="isSuperhost" className="text-sm font-bold text-gray-700 flex items-center gap-2">
                                    <Medal className="w-4 h-4 text-rose-500" />
                                    Is Superhost?
                                </label>
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Superhost Since (Year)</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.superhostSince || ''}
                                    onChange={(e) => handleChange('superhostSince', e.target.value)}
                                    placeholder="e.g. 2023"
                                    disabled={!formData.isSuperhost}
                                />
                            </div>

                             <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                                    <Mail className="w-4 h-4" /> Admin Email (display only)
                                </label>
                                <input 
                                    type="email" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.adminEmail || ''}
                                    onChange={(e) => handleChange('adminEmail', e.target.value)}
                                    placeholder="your-email@example.com"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 pt-6 mt-6">
                        <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                            <Share2 className="w-5 h-5 text-gray-600" /> Social & Platforms
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-gray-700 mb-2">Footer/Brand Image URL</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.social.footerImageUrl}
                                    onChange={(e) => handleSocialChange('footerImageUrl', e.target.value)}
                                    placeholder="https://..."
                                />
                                <p className="text-xs text-gray-500 mt-1">This image appears in the large footer card.</p>
                            </div>
                            <div className="md:col-span-2">
                                <label className="block text-sm font-bold text-gray-700 mb-2">Facebook Page URL</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.social.facebookUrl}
                                    onChange={(e) => handleSocialChange('facebookUrl', e.target.value)}
                                    placeholder="https://facebook.com/..."
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Airbnb URL</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.social.airbnbUrl || ''}
                                    onChange={(e) => handleSocialChange('airbnbUrl', e.target.value)}
                                    placeholder="Leave empty to hide"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Booking.com URL</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.social.bookingUrl || ''}
                                    onChange={(e) => handleSocialChange('bookingUrl', e.target.value)}
                                    placeholder="Leave empty to hide"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-2">Agoda URL</label>
                                <input 
                                    type="text" 
                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                    value={formData.social.agodaUrl || ''}
                                    onChange={(e) => handleSocialChange('agodaUrl', e.target.value)}
                                    placeholder="Leave empty to hide"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            {/* ... other tabs ... */}
            {activeTab === 'amenities' && (
                <div className="space-y-8">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="font-bold text-gray-900 text-lg">Property Amenities</h3>
                    </div>

                    {/* Predefined Categories */}
                    {AMENITY_CATEGORIES.map((category, idx) => (
                        <div key={idx} className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                            <h4 className="font-bold text-gray-700 mb-4 flex items-center gap-2">
                                {category.title}
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {category.items.map((item) => {
                                    const isSelected = (formData.amenities || []).includes(item.name);
                                    return (
                                        <label key={item.name} className="flex items-center gap-3 cursor-pointer group p-2 hover:bg-white rounded-lg transition-colors">
                                            <div className={`
                                                w-5 h-5 rounded border flex items-center justify-center transition-colors
                                                ${isSelected ? 'bg-blue-600 border-blue-600' : 'bg-white border-gray-300'}
                                            `}>
                                                {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                                                <input 
                                                    type="checkbox" 
                                                    className="hidden"
                                                    checked={isSelected}
                                                    onChange={() => toggleAmenity(item.name)}
                                                />
                                            </div>
                                            <div className="flex items-center gap-2 text-gray-700">
                                                <item.icon className="w-4 h-4 text-gray-400" />
                                                <span className={isSelected ? 'font-medium text-gray-900' : ''}>{item.name}</span>
                                            </div>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    ))}

                    {/* Custom Amenities */}
                    <div className="border-t border-gray-200 pt-6">
                        <h4 className="font-bold text-gray-900 mb-4">Custom Amenities</h4>
                        <div className="flex gap-2 mb-4">
                            <input 
                                type="text" 
                                className="flex-grow px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Add another amenity..."
                                value={customAmenity}
                                onChange={(e) => setCustomAmenity(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && addCustomAmenity()}
                            />
                            <button 
                                onClick={addCustomAmenity}
                                className="bg-gray-900 text-white px-4 py-2 rounded-lg font-bold hover:bg-gray-800"
                            >
                                Add
                            </button>
                        </div>
                        
                        <div className="flex flex-wrap gap-2">
                            {formData.amenities.filter(a => 
                                !AMENITY_CATEGORIES.some(c => c.items.some(i => i.name === a))
                            ).map((amenity, idx) => (
                                <div key={idx} className="bg-white border border-gray-200 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
                                    <span className="text-sm font-medium text-gray-700">{amenity}</span>
                                    <button 
                                        onClick={() => removeAmenityByName(amenity)}
                                        className="text-gray-400 hover:text-red-500"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}
                            
                            {formData.amenities.filter(a => 
                                !AMENITY_CATEGORIES.some(c => c.items.some(i => i.name === a))
                            ).length === 0 && (
                                <p className="text-gray-400 text-sm italic">No custom amenities added.</p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'gallery' && (
                <div className="space-y-8">
                    {/* Category Management */}
                    <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-gray-900 flex items-center gap-2">
                                <FolderOpen className="w-5 h-5" /> Image Categories
                            </h3>
                            <button 
                                onClick={() => setIsManagingCategories(!isManagingCategories)}
                                className="text-sm text-blue-600 font-bold hover:underline"
                            >
                                {isManagingCategories ? 'Done' : 'Manage Categories'}
                            </button>
                        </div>
                        
                        {isManagingCategories && (
                            <div className="space-y-4 mb-4 pb-4 border-b border-gray-200">
                                <div className="flex gap-2">
                                    <input 
                                        type="text" 
                                        className="flex-grow px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                        placeholder="New category name..."
                                        value={newCategoryLabel}
                                        onChange={(e) => setNewCategoryLabel(e.target.value)}
                                    />
                                    <button 
                                        onClick={addCategory}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-bold text-sm"
                                    >
                                        Add
                                    </button>
                                </div>
                            </div>
                        )}
                        
                        <div className="flex flex-wrap gap-2">
                            {formData.galleryCategories.map(cat => (
                                <div key={cat.id} className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-full text-sm text-gray-700 shadow-sm">
                                    {cat.label}
                                    {isManagingCategories && (
                                        <button 
                                            onClick={() => removeCategory(cat.id)}
                                            className="text-gray-400 hover:text-red-500 ml-1 p-0.5 rounded-full hover:bg-red-50"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="font-bold text-gray-900">Photo List</h3>
                            <button onClick={addImage} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                                <Plus className="w-4 h-4"/> Add Image
                            </button>
                        </div>
                        <div className="space-y-6">
                            {(formData.galleryImages || []).map((img, idx) => (
                                <div key={idx} className="flex flex-col md:flex-row gap-6 items-start p-4 border border-gray-200 rounded-xl bg-gray-50 relative">
                                    <button onClick={() => removeImage(idx)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500 z-10">
                                        <Trash2 className="w-5 h-5" />
                                    </button>
                                    
                                    {/* Image Preview */}
                                    <div className="w-full md:w-48 h-32 bg-gray-200 rounded-lg overflow-hidden shrink-0 border border-gray-200">
                                        {img.url ? (
                                            <img src={img.url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <div className="w-full h-full flex items-center justify-center text-gray-400">No Image</div>
                                        )}
                                    </div>
                                    
                                    {/* Fields */}
                                    <div className="flex-grow grid grid-cols-1 md:grid-cols-2 gap-4 w-full">
                                        <div className="md:col-span-2">
                                            <label className="block text-xs font-bold text-gray-500 mb-1">Image URL</label>
                                            <input 
                                                type="text" 
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                value={img.url}
                                                onChange={(e) => updateImage(idx, 'url', e.target.value)}
                                                placeholder="https://..."
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">Caption</label>
                                            <input 
                                                type="text" 
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                value={img.caption || ''}
                                                onChange={(e) => updateImage(idx, 'caption', e.target.value)}
                                                placeholder="e.g. Master Bedroom"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">Category</label>
                                            <select
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                value={img.category || 'other'}
                                                onChange={(e) => updateImage(idx, 'category', e.target.value)}
                                            >
                                                {formData.galleryCategories.map(cat => (
                                                    <option key={cat.id} value={cat.id}>{cat.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="md:col-span-2 mt-2">
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <input 
                                                    type="checkbox"
                                                    className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                                    checked={!!img.showOnHome}
                                                    onChange={(e) => updateImage(idx, 'showOnHome', e.target.checked)}
                                                />
                                                <span className={`text-sm font-bold flex items-center gap-1.5 ${img.showOnHome ? 'text-blue-600' : 'text-gray-500 group-hover:text-gray-700'}`}>
                                                    <Home className="w-4 h-4" /> Feature on Home Page
                                                </span>
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            
            {activeTab === 'pricing' && (
                <div className="space-y-8">
                    {/* Rates Section */}
                    <div>
                        <div className="flex justify-between items-center mb-4">
                             <h3 className="font-bold text-gray-900">Standard Rates</h3>
                             <button onClick={addRateTier} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                                <Plus className="w-4 h-4"/> Add Tier
                            </button>
                        </div>
                        <div className="space-y-3">
                            {formData.pricing.rates.map((rate, idx) => (
                                <div key={idx} className="flex items-center gap-4 bg-gray-50 p-3 rounded-xl border border-gray-200 relative group">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-gray-500 w-16">Guests:</span>
                                        <input 
                                            type="number" 
                                            className="w-20 p-2 border border-gray-300 rounded-lg text-center font-bold" 
                                            value={rate.guests} 
                                            onChange={e => updateRateTier(idx, 'guests', parseInt(e.target.value) || 0)} 
                                        />
                                    </div>
                                    <div className="flex items-center gap-2 flex-grow">
                                        <span className="text-sm font-bold text-gray-500">Price:</span>
                                        <input 
                                            type="number" 
                                            className="flex-grow p-2 border border-gray-300 rounded-lg text-right font-bold" 
                                            value={rate.price} 
                                            onChange={e => updateRateTier(idx, 'price', parseInt(e.target.value) || 0)} 
                                        />
                                        <span className="text-gray-400 font-medium">JPY</span>
                                    </div>
                                    <button onClick={() => removeRateTier(idx)} className="p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Cleaning Fee Section */}
                    <div className="border-t border-gray-200 pt-6">
                        <div className="flex justify-between items-center mb-4">
                             <h3 className="font-bold text-gray-900">Cleaning Fees</h3>
                             <button onClick={addCleaningTier} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                                <Plus className="w-4 h-4"/> Add Tier
                            </button>
                        </div>
                        <div className="space-y-3">
                            {formData.pricing.cleaning.map((tier, idx) => (
                                <div key={idx} className="flex flex-col md:flex-row items-center gap-4 bg-gray-50 p-3 rounded-xl border border-gray-200 relative group">
                                    <div className="flex items-center gap-2">
                                        <input 
                                            type="number" 
                                            className="w-16 p-2 border border-gray-300 rounded-lg text-center font-bold" 
                                            value={tier.minGuests} 
                                            onChange={e => updateCleaningTier(idx, 'minGuests', parseInt(e.target.value) || 0)} 
                                        />
                                        <span className="text-gray-400">-</span>
                                        <input 
                                            type="number" 
                                            className="w-16 p-2 border border-gray-300 rounded-lg text-center font-bold" 
                                            value={tier.maxGuests} 
                                            onChange={e => updateCleaningTier(idx, 'maxGuests', parseInt(e.target.value) || 0)} 
                                        />
                                        <span className="text-sm font-bold text-gray-500 ml-1">Guests</span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-grow w-full md:w-auto">
                                        <span className="text-sm font-bold text-gray-500">Fee:</span>
                                        <input 
                                            type="number" 
                                            className="flex-grow p-2 border border-gray-300 rounded-lg text-right font-bold" 
                                            value={tier.price} 
                                            onChange={e => updateCleaningTier(idx, 'price', parseInt(e.target.value) || 0)} 
                                        />
                                        <span className="text-gray-400 font-medium">JPY</span>
                                    </div>
                                    <button onClick={() => removeCleaningTier(idx)} className="p-2 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-2 md:static">
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Discounts Section */}
                    <div className="border-t border-gray-200 pt-6">
                        <h3 className="font-bold text-gray-900 mb-4">Discounts & Policies</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <h4 className="font-bold text-gray-700 mb-3 text-sm uppercase">Long Stay Discount</h4>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Discount Percentage (%)</label>
                                        <input 
                                            type="number" 
                                            className="w-full p-2 border border-gray-300 rounded-lg" 
                                            value={formData.pricing.longStayDiscountPercent} 
                                            onChange={e => updateDiscount('longStayDiscountPercent', parseInt(e.target.value) || 0)} 
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Minimum Nights</label>
                                        <input 
                                            type="number" 
                                            className="w-full p-2 border border-gray-300 rounded-lg" 
                                            value={formData.pricing.longStayMinNights} 
                                            onChange={e => updateDiscount('longStayMinNights', parseInt(e.target.value) || 0)} 
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                                <h4 className="font-bold text-gray-700 mb-3 text-sm uppercase">Child Discount</h4>
                                <div className="space-y-3">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Discount Percentage (%)</label>
                                        <input 
                                            type="number" 
                                            className="w-full p-2 border border-gray-300 rounded-lg" 
                                            value={formData.pricing.childDiscountPercent} 
                                            onChange={e => updateDiscount('childDiscountPercent', parseInt(e.target.value) || 0)} 
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">Min Age</label>
                                            <input 
                                                type="number" 
                                                className="w-full p-2 border border-gray-300 rounded-lg" 
                                                value={formData.pricing.childAgeMin} 
                                                onChange={e => updateDiscount('childAgeMin', parseInt(e.target.value) || 0)} 
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-1">Max Age</label>
                                            <input 
                                                type="number" 
                                                className="w-full p-2 border border-gray-300 rounded-lg" 
                                                value={formData.pricing.childAgeMax} 
                                                onChange={e => updateDiscount('childAgeMax', parseInt(e.target.value) || 0)} 
                                            />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ... other existing tabs ... */}
            {activeTab === 'ical' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-gray-900">iCal Feeds</h3>
                        <button onClick={addIcal} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                            <Plus className="w-4 h-4"/> Add Calendar
                        </button>
                    </div>
                    {formData.icalFeeds.map(feed => (
                        <div key={feed.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50 relative">
                            <button onClick={() => removeIcal(feed.id)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500">
                                <X className="w-4 h-4" />
                            </button>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Name</label>
                                    <input 
                                        type="text" 
                                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                                        value={feed.name}
                                        onChange={(e) => updateIcal(feed.id, 'name', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">iCal URL</label>
                                    <input 
                                        type="text" 
                                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-xs font-mono"
                                        value={feed.url}
                                        onChange={(e) => updateIcal(feed.id, 'url', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            
             {activeTab === 'labels' && (
                <div className="space-y-8">
                     <div className="bg-gray-50 p-6 rounded-xl border border-gray-200">
                         <h3 className="font-bold text-gray-900 mb-4 text-lg">Page Titles & Subtitles</h3>
                         <div className="grid grid-cols-1 gap-6">

                             {/* Navigation Menu Section */}
                             <div className="space-y-4 border-b border-gray-200 pb-6">
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Navigation Menu</h4>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Home Label</label>
                                        <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                            value={formData.titles.menuHome} onChange={(e) => handleTitleChange('menuHome', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Access Label</label>
                                        <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                            value={formData.titles.menuAccess} onChange={(e) => handleTitleChange('menuAccess', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Pricing Label</label>
                                        <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                            value={formData.titles.menuPricing} onChange={(e) => handleTitleChange('menuPricing', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Rules Label</label>
                                        <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                            value={formData.titles.menuRules} onChange={(e) => handleTitleChange('menuRules', e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Manual Label</label>
                                        <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                            value={formData.titles.menuManual} onChange={(e) => handleTitleChange('menuManual', e.target.value)} />
                                    </div>
                                </div>
                             </div>
                             
                             {/* Home Page Section */}
                             <div className="space-y-4 border-b border-gray-200 pb-6">
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Home Page Sections</h4>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">About Title</label>
                                    <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                        value={formData.titles.about} onChange={(e) => handleTitleChange('about', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Sleeping Arrangements Title</label>
                                    <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                        value={formData.titles.sleeping} onChange={(e) => handleTitleChange('sleeping', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Amenities Title</label>
                                    <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                        value={formData.titles.amenities} onChange={(e) => handleTitleChange('amenities', e.target.value)} />
                                </div>
                             </div>

                             {/* Access Page Section */}
                             <div className="space-y-4 border-b border-gray-200 pb-6">
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Access Page</h4>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Title</label>
                                    <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                        value={formData.titles.access} onChange={(e) => handleTitleChange('access', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Subtitle</label>
                                    <textarea className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white h-20" 
                                        value={formData.titles.accessSubtitle} onChange={(e) => handleTitleChange('accessSubtitle', e.target.value)} />
                                </div>
                             </div>

                             {/* Pricing Page Section */}
                             <div className="space-y-4 border-b border-gray-200 pb-6">
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Pricing Page</h4>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Title</label>
                                    <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                        value={formData.titles.pricing} onChange={(e) => handleTitleChange('pricing', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Subtitle</label>
                                    <textarea className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white h-20" 
                                        value={formData.titles.pricingSubtitle} onChange={(e) => handleTitleChange('pricingSubtitle', e.target.value)} />
                                </div>
                             </div>

                             {/* Rules Page Section */}
                             <div className="space-y-4 border-b border-gray-200 pb-6">
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Rules Page</h4>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Title</label>
                                    <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                        value={formData.titles.rules} onChange={(e) => handleTitleChange('rules', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Subtitle</label>
                                    <textarea className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white h-20" 
                                        value={formData.titles.rulesSubtitle} onChange={(e) => handleTitleChange('rulesSubtitle', e.target.value)} />
                                </div>
                             </div>

                             {/* Manual Page Section */}
                             <div className="space-y-4">
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Manual Page</h4>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Title</label>
                                    <input type="text" className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white" 
                                        value={formData.titles.manual} onChange={(e) => handleTitleChange('manual', e.target.value)} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Page Subtitle</label>
                                    <textarea className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-white h-20" 
                                        value={formData.titles.manualSubtitle} onChange={(e) => handleTitleChange('manualSubtitle', e.target.value)} />
                                </div>
                             </div>
                         </div>
                     </div>
                </div>
            )}
            
            {activeTab === 'rules' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-gray-900">House Rules</h3>
                        <button onClick={addRule} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                            <Plus className="w-4 h-4"/> Add Rule
                        </button>
                    </div>
                    {formData.rules.map(rule => (
                        <div key={rule.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50 flex flex-col md:flex-row gap-4 items-start relative">
                             <div className="flex-1 space-y-3 w-full">
                                 <input 
                                     type="text" 
                                     className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                                     value={rule.text}
                                     onChange={(e) => updateRule(rule.id, 'text', e.target.value)}
                                     placeholder="Rule text..."
                                 />
                                 <div className="flex gap-4">
                                     <select 
                                         className="flex-1 px-3 py-2 border border-gray-300 rounded bg-white text-sm"
                                         value={rule.icon}
                                         onChange={(e) => updateRule(rule.id, 'icon', e.target.value)}
                                     >
                                         {ICON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                     </select>
                                     <select 
                                         className="flex-1 px-3 py-2 border border-gray-300 rounded bg-white text-sm"
                                         value={rule.type}
                                         onChange={(e) => updateRule(rule.id, 'type', e.target.value)}
                                     >
                                         <option value="allowed">Allowed</option>
                                         <option value="forbidden">Forbidden</option>
                                     </select>
                                 </div>
                             </div>
                             <button onClick={() => removeRule(rule.id)} className="text-gray-400 hover:text-red-500 p-2 md:static absolute top-2 right-2"><Trash2 className="w-5 h-5"/></button>
                        </div>
                    ))}
                    <div>
                        <h3 className="font-bold text-gray-900 mb-2 mt-6">Additional Notes</h3>
                         <textarea 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-32 bg-white text-gray-900"
                            value={formData.additionalRules}
                            onChange={(e) => handleChange('additionalRules', e.target.value)}
                        />
                    </div>
                </div>
            )}

            {activeTab === 'manual' && (
                 <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-gray-900">House Manual</h3>
                        <button onClick={addManualItem} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                            <Plus className="w-4 h-4"/> Add Guide
                        </button>
                    </div>
                    {formData.manual.map(item => (
                        <div key={item.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50 relative">
                             <button onClick={() => removeManualItem(item.id)} className="absolute top-2 right-2 text-gray-400 hover:text-red-500"><X className="w-5 h-5"/></button>
                             <div className="space-y-4 pt-4 md:pt-0">
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Title</label>
                                    <input 
                                        type="text" 
                                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white font-bold"
                                        value={item.title}
                                        onChange={(e) => updateManualItem(item.id, 'title', e.target.value)}
                                    />
                                 </div>
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Content</label>
                                    <textarea 
                                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white h-24"
                                        value={item.content}
                                        onChange={(e) => updateManualItem(item.id, 'content', e.target.value)}
                                    />
                                 </div>
                                 <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Image URL (Optional)</label>
                                    <input 
                                        type="text" 
                                        className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-sm text-gray-600"
                                        value={item.imageUrl || ''}
                                        onChange={(e) => updateManualItem(item.id, 'imageUrl', e.target.value)}
                                    />
                                 </div>
                             </div>
                        </div>
                    ))}
                 </div>
            )}

            {activeTab === 'rooms' && (
                <div className="space-y-6">
                     <div className="flex justify-between items-center">
                        <h3 className="font-bold text-gray-900">Bedrooms & Sleeping</h3>
                        <button onClick={addRoom} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                            <Plus className="w-4 h-4"/> Add Room
                        </button>
                    </div>
                    {formData.sleepingArrangements?.map(room => (
                        <div key={room.id} className="p-6 border border-gray-200 rounded-xl bg-gray-50 relative">
                             <button onClick={() => removeRoom(room.id)} className="absolute top-4 right-4 text-gray-400 hover:text-red-500"><X className="w-5 h-5"/></button>
                             <div className="space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 md:pt-0">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Room Name</label>
                                        <input 
                                            type="text" className="w-full px-3 py-2 border border-gray-300 rounded bg-white font-bold"
                                            value={room.title} onChange={(e) => updateRoom(room.id, 'title', e.target.value)}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Bed Description</label>
                                        <input 
                                            type="text" className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                                            value={room.description} onChange={(e) => updateRoom(room.id, 'description', e.target.value)}
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">Cover Image URL</label>
                                    <div className="flex flex-col md:flex-row gap-4">
                                        <div className="w-full md:w-16 h-32 md:h-12 bg-gray-200 rounded shrink-0 overflow-hidden">
                                            {room.imageUrl && <img src={room.imageUrl} className="w-full h-full object-cover" alt="" />}
                                        </div>
                                        <input 
                                            type="text" className="flex-grow px-3 py-2 border border-gray-300 rounded bg-white text-sm"
                                            value={room.imageUrl} onChange={(e) => updateRoom(room.id, 'imageUrl', e.target.value)}
                                        />
                                    </div>
                                </div>
                                
                                <div className="pt-2">
                                    <label className="block text-xs font-bold text-gray-500 mb-2">Additional Photos</label>
                                    <div className="space-y-2 pl-4 border-l-2 border-gray-200">
                                        {(room.photos || []).map((photo, pIdx) => (
                                            <div key={pIdx} className="flex gap-2">
                                                 <input 
                                                    type="text" className="flex-grow px-3 py-1 border border-gray-300 rounded bg-white text-sm"
                                                    value={photo} onChange={(e) => updateRoomPhoto(room.id, pIdx, e.target.value)}
                                                    placeholder="Photo URL..."
                                                />
                                                <button onClick={() => removeRoomPhoto(room.id, pIdx)} className="text-red-400 hover:text-red-600"><X className="w-4 h-4"/></button>
                                            </div>
                                        ))}
                                        <button onClick={() => addRoomPhoto(room.id)} className="text-xs text-blue-600 font-bold hover:underline">+ Add Photo</button>
                                    </div>
                                </div>
                             </div>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'highlights' && (
                <div className="space-y-6">
                    <div className="flex justify-between items-center">
                        <h3 className="font-bold text-gray-900">Highlights</h3>
                        <button onClick={addHighlight} className="text-sm text-blue-600 font-bold hover:underline flex items-center gap-1">
                            <Plus className="w-4 h-4"/> Add Item
                        </button>
                    </div>
                    {formData.highlights?.map(item => (
                        <div key={item.id} className="p-4 border border-gray-200 rounded-lg bg-gray-50 flex flex-col md:flex-row gap-4 items-start relative">
                             <div className="flex-1 space-y-3 w-full">
                                 <div className="flex gap-4">
                                     <div className="flex-1">
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Title</label>
                                        <input 
                                            type="text" className="w-full px-3 py-2 border border-gray-300 rounded bg-white font-bold"
                                            value={item.title} onChange={(e) => updateHighlight(item.id, 'title', e.target.value)}
                                        />
                                     </div>
                                     <div className="w-1/3">
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Icon</label>
                                        <select 
                                            className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                                            value={item.icon} onChange={(e) => updateHighlight(item.id, 'icon', e.target.value)}
                                        >
                                            {HIGHLIGHT_ICON_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                                        </select>
                                     </div>
                                 </div>
                                 <div>
                                     <label className="block text-xs font-bold text-gray-500 mb-1">Description</label>
                                     <input 
                                        type="text" className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-sm"
                                        value={item.description} onChange={(e) => updateHighlight(item.id, 'description', e.target.value)}
                                     />
                                 </div>
                             </div>
                             <button onClick={() => removeHighlight(item.id)} className="text-gray-400 hover:text-red-500 md:mt-6 absolute top-2 right-2 md:static"><Trash2 className="w-5 h-5"/></button>
                        </div>
                    ))}
                </div>
            )}

            {activeTab === 'access' && (
                <div className="space-y-6">
                    <h3 className="font-bold text-gray-900">Access Information</h3>
                    <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-2">Address *</label>
                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-500 mb-1">Country *</label>
                                                        <select
                                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                            value={selectedCountryCode || ''}
                                                            onChange={(e) => handleCountrySelect(e.target.value)}
                                                        >
                                                            <option value="">Select country</option>
                                                            {COUNTRY_OPTIONS.map((country) => (
                                                                <option key={country.code} value={country.code}>{country.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-gray-500 mb-1">Province *</label>
                                                        <select
                                                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900 disabled:bg-gray-100"
                                                            value={selectedProvinceCode}
                                                            onChange={(e) => handleProvinceSelect(e.target.value)}
                                                            disabled={!selectedCountryCode}
                                                        >
                                                            <option value="">Select province</option>
                                                            {provinceOptions.map((province) => (
                                                                <option key={province.code} value={province.code}>{province.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                </div>
                                                <div className="mt-3">
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">Address detail (optional)</label>
                                                    <input
                                                        type="text"
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                        value={formData.location?.cityName || ''}
                                                        onChange={(e) => handleAddressDetailChange(e.target.value)}
                                                        placeholder="Street, ward, district, building..."
                                                    />
                                                </div>
                                                <p className="mt-2 text-xs text-gray-500">
                                                    Address preview: {formData.address || 'Please select Country and Province'}
                                                </p>
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Google Maps Embed URL</label>
                        <input 
                            type="text" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm font-mono text-gray-500 bg-white"
                            value={formData.mapEmbedUrl}
                            onChange={(e) => handleChange('mapEmbedUrl', e.target.value)}
                        />
                    </div>
                                        {selectedCountryCode === 'JP' && (
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Nearest train station (Japan only)</label>
                                                    <input
                                                        type="text"
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                        value={formData.accessInfo.nearestStationName || ''}
                                                        onChange={(e) => handleAccessChange('nearestStationName', e.target.value)}
                                                        placeholder="Example: Ojima Station"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="block text-sm font-bold text-gray-700 mb-2">Distance to station (Japan only)</label>
                                                    <input
                                                        type="text"
                                                        className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                        value={formData.accessInfo.nearestStationDistance || ''}
                                                        onChange={(e) => handleAccessChange('nearestStationDistance', e.target.value)}
                                                        placeholder="Example: 8 minutes walk"
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {selectedCountryCode === 'VN' && (
                                            <div>
                                                <label className="block text-sm font-bold text-gray-700 mb-2">Drive time to nearest airport (Vietnam only)</label>
                                                <input
                                                    type="text"
                                                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                                                    value={formData.accessInfo.nearestAirportDriveTime || ''}
                                                    onChange={(e) => handleAccessChange('nearestAirportDriveTime', e.target.value)}
                                                    placeholder="Example: 35 minutes by car"
                                                />
                                            </div>
                                        )}
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Train Access</label>
                        <textarea 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-24 bg-white text-gray-900"
                            value={formData.accessInfo.train}
                            onChange={(e) => handleAccessChange('train', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Airport Access</label>
                        <textarea 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-24 bg-white text-gray-900"
                            value={formData.accessInfo.airport}
                            onChange={(e) => handleAccessChange('airport', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">Check-in Instructions</label>
                        <textarea 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none h-24 bg-white text-gray-900"
                            value={formData.accessInfo.checkIn}
                            onChange={(e) => handleAccessChange('checkIn', e.target.value)}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2">YouTube Guide URL</label>
                        <input 
                            type="text" 
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white text-gray-900"
                            value={formData.accessInfo.youtubeGuideUrl || ''}
                            onChange={(e) => handleAccessChange('youtubeGuideUrl', e.target.value)}
                            placeholder="https://youtu.be/..."
                        />
                    </div>
                </div>
            )}

        </div>
      </div>
    </div>
  );
};

export default AdminPage;
