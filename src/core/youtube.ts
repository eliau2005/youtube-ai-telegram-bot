import { google, youtube_v3 } from 'googleapis';
import { config } from '../config';
import type { Video } from './types';

let cachedYoutube: youtube_v3.Youtube | null = null;

function getYoutube(): youtube_v3.Youtube {
  if (cachedYoutube) return cachedYoutube;
  cachedYoutube = google.youtube({ version: 'v3', auth: config.youtubeApiKey });
  return cachedYoutube;
}

export function extractPlaylistId(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = trimmed.match(/[?&]list=([A-Za-z0-9_-]{10,})/);
  if (fromUrl) return fromUrl[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

export async function fetchAllPlaylistItems(
  playlistId: string,
  log: (text: string) => void
): Promise<Video[]> {
  const youtube = getYoutube();
  const allItems: Video[] = [];
  let nextPageToken: string | undefined;
  let globalOrder = 1;

  log(`Fetching videos from YouTube playlist: ${playlistId}...`);
  do {
    const response = await youtube.playlistItems.list({
      part: ['snippet'],
      playlistId,
      maxResults: 50,
      pageToken: nextPageToken
    });
    const items = (response.data.items ?? []).map((item) => {
      const videoId = item.snippet?.resourceId?.videoId ?? '';
      return {
        originalOrder: globalOrder++,
        videoId,
        title: item.snippet?.title ?? '',
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`
      };
    });
    allItems.push(...items);
    nextPageToken = response.data.nextPageToken ?? undefined;
  } while (nextPageToken);

  log(`Fetched ${allItems.length} videos from YouTube.`);
  return allItems;
}
