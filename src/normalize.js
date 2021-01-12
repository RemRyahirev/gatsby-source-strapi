import { has, isObject } from 'lodash/fp';
import { createRemoteFileNode } from 'gatsby-source-filesystem';

const isImage = has('mime');
const getUpdatedAt = (image) => image.updatedAt || image.updated_at;

const extractImage = async (image, ctx) => {
  const { apiURL, store, cache, createNode, createNodeId, touchNode, auth } = ctx;

  let fileNodeID;

  // using field on the cache key for multiple image field
  const mediaDataCacheKey = `strapi-media-${image.id}`;
  const cacheMediaData = await cache.get(mediaDataCacheKey);

  // If we have cached media data and it wasn't modified, reuse
  // previously created file node to not try to redownload
  if (cacheMediaData && getUpdatedAt(image) === cacheMediaData.updatedAt) {
    fileNodeID = cacheMediaData.fileNodeID;
    touchNode({ nodeId: fileNodeID });
  }

  // If we don't have cached data, download the file
  if (!fileNodeID) {
    // full media url
    const source_url = `${image.url.startsWith('http') ? '' : apiURL}${image.url}`;
    const fileNode = await createRemoteFileNode({
      url: source_url,
      store,
      cache,
      createNode,
      createNodeId,
      auth,
      ext: image.ext,
      name: image.name,
    });

    if (fileNode) {
      fileNodeID = fileNode.id;

      await cache.set(mediaDataCacheKey, {
        fileNodeID,
        updatedAt: getUpdatedAt(image),
      });
    }
  }

  if (fileNodeID) {
    image.localFile___NODE = fileNodeID;
  }
};

const extractRichText = async (id, item, field, ctx) => {
  const { cache, touchNode, createNode, createNodeId, createContentDigest } = ctx;

  const content = item[field] || '';
  const contentDigest = createContentDigest(content);

  let nodeId;

  const mediaDataCacheKey = `strapi-richtext-${contentDigest}`;
  const cacheMediaData = await cache.get(mediaDataCacheKey);

  if (cacheMediaData) {
    nodeId = cacheMediaData.nodeId;
    touchNode({ nodeId });
  }

  if (!nodeId) {
    const newNode = {
      id: createNodeId(contentDigest),
      children: [],
      parent: null,
      internal: {
        content,
        type: 'StrapiRichText',
        mediaType: 'text/markdown',
        contentDigest,
      }
    };

    await createNode(newNode);

    nodeId = newNode.id;

    await cache.set(mediaDataCacheKey, { nodeId });
  }

  delete item[field];
  item[`${field}___NODE`] = nodeId;
};

const extractFields = async (maps, item, ctx, path, nodeId = path) => {
  if (isImage(item)) {
    return extractImage(item, ctx);
  }

  if (Array.isArray(item)) {
    let i = 0;
    for (const element of item) {
      if (maps.richTextPaths[path]) {
        await extractRichText(nodeId, item, i, ctx);
        continue;
      }

      await extractFields(maps, element, ctx, path, `${nodeId}.${i}`);
      ++i;
    }

    return;
  }

  if (isObject(item)) {
    for (const key in item) {
      const newPath = `${path}.${key}`;

      if (maps.richTextPaths[newPath]) {
        await extractRichText(nodeId, item, key, ctx);
        continue;
      }

      await extractFields(maps, item[key], ctx, newPath, `${nodeId}.${key}`);
    }

    return;
  }
};

// Downloads media from image type fields
exports.downloadMediaFiles = async (name, maps, entities, ctx) => {
  return Promise.all(entities.map((entity, i) => extractFields(maps, entity, ctx, name, `${name}.${i}`)));
};
