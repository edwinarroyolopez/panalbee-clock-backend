import { Inject, Injectable } from '@nestjs/common';
import { AppException } from '../common/app-exception';
import { ChannelAdapter, ChannelType } from './channel-adapter';

export const CHANNEL_ADAPTERS = Symbol('CHANNEL_ADAPTERS');

@Injectable()
export class ChannelAdapterRegistry {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  constructor(
    @Inject(CHANNEL_ADAPTERS) initialAdapters: readonly ChannelAdapter[],
  ) {
    for (const adapter of initialAdapters) this.register(adapter);
  }

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.channelType)) {
      throw new Error(
        `Channel adapter already registered: ${adapter.channelType}`,
      );
    }
    this.adapters.set(adapter.channelType, adapter);
  }

  get(channelType: ChannelType): ChannelAdapter {
    const adapter = this.adapters.get(channelType);
    if (!adapter) {
      throw new AppException(
        503,
        'CHANNEL_ADAPTER_UNAVAILABLE',
        'The conversation channel is unavailable',
      );
    }
    return adapter;
  }
}
