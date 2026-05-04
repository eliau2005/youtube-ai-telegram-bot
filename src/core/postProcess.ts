import type { ApprovedVideo, ProcessedVideo } from './types';

export function finalizeApprovedVideos(approved: ApprovedVideo[]): ProcessedVideo[] {
  const groupedVideos: Record<string, ApprovedVideo[]> = {};
  for (const vid of approved) {
    const groupKey = vid.lessonGroup ?? `no-group-${vid.subCategory}`;
    if (!groupedVideos[groupKey]) groupedVideos[groupKey] = [];
    groupedVideos[groupKey].push(vid);
  }

  const finalProcessedVideos: ProcessedVideo[] = [];

  for (const groupKey of Object.keys(groupedVideos)) {
    const group = groupedVideos[groupKey];
    const unifiedBaseSlug = group.find((v) => v.baseSlug)?.baseSlug ?? 'lesson';

    group.sort((a, b) => {
      const simanA = a.simanValue ?? 999_999;
      const simanB = b.simanValue ?? 999_999;
      if (simanA !== simanB) return simanA - simanB;
      const secA = a.simanSectionValue ?? 999_999;
      const secB = b.simanSectionValue ?? 999_999;
      if (secA !== secB) return secA - secB;
      return a.originalOrder - b.originalOrder;
    });

    group.forEach((vid, index) => {
      const finalOrder = index + 1;
      const paddedOrder = String(finalOrder).padStart(2, '0');
      const finalSlug = `${unifiedBaseSlug}-${paddedOrder}-${vid.videoId}`;
      finalProcessedVideos.push({
        videoId: vid.videoId,
        youtubeUrl: vid.youtubeUrl,
        originalTitle: vid.originalTitle,
        lessonTitle: vid.lessonTitle,
        description: vid.description,
        rabbi: vid.rabbi,
        category: vid.category,
        subCategory: vid.subCategory,
        lessonGroup: vid.lessonGroup,
        order: finalOrder,
        slug: finalSlug
      });
    });
  }

  finalProcessedVideos.sort((a, b) => {
    const origA = approved.find((v) => v.videoId === a.videoId)?.originalOrder ?? 0;
    const origB = approved.find((v) => v.videoId === b.videoId)?.originalOrder ?? 0;
    return origA - origB;
  });

  return finalProcessedVideos;
}
