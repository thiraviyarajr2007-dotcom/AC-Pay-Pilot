import type { SmartCartItem } from '../components/screens/SmartCartScreen';

export const SMART_CART_STORAGE_KEY = 'paypilot_smart_cart_v1';

export const SAMPLE_CART_ITEMS: SmartCartItem[] = [
  {
    sku: '#FAN-BLDC-892',
    name: 'AeroBreeze Stealth 1200mm Smart BLDC Ceiling Fan',
    category: 'Smart Ceiling Fans • 28W BLDC',
    hsCode: '8414.51.10',
    unitPrice: 8499,
    qty: 2,
    selected: true,
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuAdZqURIDL_NaUXiAifTbLg4cem9jV1GV8iZOZph4aZvIM_kBIBsVSYaq0LFoeWQ1Xe11jOuDpYR0RHnVhSurjQprJuCqeXfR6luOW8JojolfW3AL3RlJG5cFe-YmAZaYz7-lll8h5sqcs83z5WRWhCSmB_-pIxVPGanujJtlcWqHaGPRDckKJmoCqqWoVmhA4SIWYCZ53ylY77gEHOrpObunEt2PyFUzIVJzYoOpMS9aQvgYTluWmbLg',
  },
  {
    sku: '#SPO-YNX-99P',
    name: 'Yonex Astrox 99 Pro Carbon Badminton Racket',
    category: 'Sports & Fitness • 4U Carbon',
    hsCode: '9506.59.10',
    unitPrice: 14990,
    qty: 1,
    selected: true,
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuDURq8df1AvNhd6BXPOnLSDepBVFAZQQdhN7XCJzqUwmcV79SqYGalleVqm5XyenVa4nFesHY7jCNLROrqBHlgtE92aPFjCmcNoiYuJEPzJjul5AYdnnHkeKQevXmwyO8xozEtp1qExjA6sfd8tRUMhTAaE5rLBnqslJx9r-5JgtL82V5kmTgx9bt5QmOiAjh1sa5vjPP7EB5WSaeKeMK9zuVgCH8RJFezfeBmyvYUJuYqroAVrKuYT6A',
  },
  {
    sku: '#AUD-ANC-99',
    name: 'AcousticSphere ANC Wireless Earbuds',
    category: 'Audio & Accessories',
    hsCode: '8518.30.00',
    unitPrice: 11499,
    qty: 1,
    selected: true,
    img: 'https://lh3.googleusercontent.com/aida-public/AB6AXuATX6652NttkNvGUKx5jflqNG9RH8CT1bcmBhwPs5ONeLhU9pt_yu_fLrBW741KftvyB8iGKx74rvwQHwuPCAi3l4R3tYkHwBDG9n3OPdy9Mlu8L_I0x4OPz9BwauAkb1vv9Y9m6inErwdhjPUN3ppwCGPbYGt503flhtRIVgYmpxZIuYY_1j9Rm3YHrFW7YLzOu7wmGH2HMVU6LtZPoH8W80bhQ8Ax7MbgTzEynmMscW556GyOm__wiw',
  },
];

export function loadInitialSmartCart(isLiveDataSource: boolean): SmartCartItem[] {
  if (typeof window === 'undefined') {
    return isLiveDataSource ? [] : SAMPLE_CART_ITEMS;
  }
  try {
    const raw = window.localStorage.getItem(SMART_CART_STORAGE_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as SmartCartItem[];
    }
  } catch {
    // Ignore corrupt localStorage and fall back cleanly
  }
  return isLiveDataSource ? [] : SAMPLE_CART_ITEMS;
}

export function persistSmartCart(items: SmartCartItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SMART_CART_STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Ignore storage quota errors
  }
}

