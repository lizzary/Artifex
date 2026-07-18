import { downloadIllustrations } from './downloadIllustrations';

describe('downloadIllustrations', () => {
  const illustration = {
    id: 7,
    file_url: '/api/illustrations/7/file',
    original_filename: 'original.png',
    group_name: 'Studio',
    width: 10,
    height: 20,
  };

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      blob: jest.fn().mockResolvedValue(new Blob(['image'])),
    });
    URL.createObjectURL = jest.fn(() => 'blob:qa');
    URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => jest.restoreAllMocks());

  test('uses the shared naming template before triggering a download', async () => {
    const filenames = [];
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function captureDownload() {
      filenames.push(this.download);
    });

    const result = await downloadIllustrations([illustration], '<group>_<Resolution>');

    expect(global.fetch).toHaveBeenCalledWith('/api/illustrations/7/file');
    expect(filenames).toEqual(['Studio_10x20.png']);
    expect(result).toEqual({ downloaded: [7], failed: [] });
  });

  test('continues after a failed file without reporting it as downloaded', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404 });
    const result = await downloadIllustrations([illustration], 'ignored');
    expect(result.downloaded).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].id).toBe(7);
  });

  test('prefixes relative file URLs with the configured API base URL', async () => {
    const previousBaseUrl = process.env.REACT_APP_API_BASE_URL;
    process.env.REACT_APP_API_BASE_URL = 'https://artifex.example/api-root/';
    jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    await downloadIllustrations([illustration], '');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://artifex.example/api-root/api/illustrations/7/file',
    );
    if (previousBaseUrl === undefined) delete process.env.REACT_APP_API_BASE_URL;
    else process.env.REACT_APP_API_BASE_URL = previousBaseUrl;
  });
});
