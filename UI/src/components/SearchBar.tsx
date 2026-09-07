import { useState, useEffect } from 'react';
import { Search, X } from 'lucide-react';

type SearchBarProps = {
  onSearch: (query: string) => void;
  placeholder?: string;
};

export const SearchBar = ({ onSearch, placeholder = "بحث..." }: SearchBarProps) => {
  const [query, setQuery] = useState('');
  
  // Implement debouncing
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(query);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [query, onSearch]);
  
  return (
    <div className="relative">
      <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
        <Search className="h-5 w-5 text-gray-400" />
      </div>
      <input
        type="text"
        className="input pr-10 pl-4"
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {query && (
        <button
          className="absolute inset-y-0 left-0 pl-3 flex items-center"
          onClick={() => setQuery('')}
        >
          <X className="h-5 w-5 text-gray-400 hover:text-gray-600" />
        </button>
      )}
    </div>
  );
};