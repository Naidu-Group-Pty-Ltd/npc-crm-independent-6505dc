import React, { createContext, useContext, useState, ReactNode } from 'react';

interface SearchContextType {
  globalSearchQuery: string;
  setGlobalSearchQuery: (query: string) => void;
  clearSearch: () => void;
}

const SearchContext = createContext<SearchContextType | undefined>(undefined);

export function SearchProvider({ children }: { children: ReactNode }) {
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');

  const clearSearch = () => {
    setGlobalSearchQuery('');
  };

  return (
    <SearchContext.Provider value={{
      globalSearchQuery,
      setGlobalSearchQuery,
      clearSearch,
    }}>
      {children}
    </SearchContext.Provider>
  );
}

export function useSearch() {
  const context = useContext(SearchContext);
  if (context === undefined) {
    throw new Error('useSearch must be used within a SearchProvider');
  }
  return context;
}