import { Module } from '@nestjs/common';
import { TavilyWebSearchProvider } from './providers/tavily-web-search.provider';
import { WebSearchService } from './web-search.service';
import { WEB_SEARCH_PROVIDER } from './web-search.types';

@Module({
  providers: [
    TavilyWebSearchProvider,
    {
      provide: WEB_SEARCH_PROVIDER,
      useExisting: TavilyWebSearchProvider,
    },
    WebSearchService,
  ],
  exports: [WebSearchService],
})
export class WebSearchModule {}
