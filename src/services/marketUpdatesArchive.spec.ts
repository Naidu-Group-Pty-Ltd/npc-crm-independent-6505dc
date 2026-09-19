import {beforeEach,describe,expect,it,vi} from 'vitest';

const {invokeSecureFunction}=vi.hoisted(()=>({invokeSecureFunction:vi.fn()}));
vi.mock('@/lib/secureInvoke',()=>({invokeSecureFunction}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));

import {archiveMarketUpdate,restoreMarketUpdate,setMarketNewsArchiveState} from './marketUpdatesService';

const updateId='123e4567-e89b-42d3-a456-426614174000';

describe('Market News Feed archive service',()=>{
  beforeEach(()=>invokeSecureFunction.mockReset());

  it('uses one canonical endpoint and archive-state contract',async()=>{
    invokeSecureFunction.mockResolvedValue({data:{id:updateId,archived_at:'2026-08-02T00:00:00.000Z',outcome:'archived',correlation_id:'223e4567-e89b-42d3-a456-426614174000'},error:null});
    await expect(archiveMarketUpdate(updateId)).resolves.toMatchObject({id:updateId,isArchived:true,outcome:'archived'});
    expect(invokeSecureFunction).toHaveBeenCalledOnce();
    expect(invokeSecureFunction).toHaveBeenCalledWith('market-news-archive-v2',{action:'set_archive_state',updateId,archived:true});
  });

  it('uses the same endpoint to restore with archived false',async()=>{
    invokeSecureFunction.mockResolvedValue({data:{id:updateId,outcome:'restored',correlation_id:'223e4567-e89b-42d3-a456-426614174000'},error:null});
    await expect(restoreMarketUpdate(updateId)).resolves.toMatchObject({id:updateId,isArchived:false,outcome:'restored'});
    expect(invokeSecureFunction).toHaveBeenCalledWith('market-news-archive-v2',{action:'set_archive_state',updateId,archived:false});
  });

  it('falls back to the single-purpose endpoint when the status deployment is stale',async()=>{
    invokeSecureFunction
      .mockResolvedValueOnce({data:{error:'Unknown action'},error:{message:'Unknown action',status:400,code:'invalid_request'}})
      .mockResolvedValueOnce({data:{ok:true,data:{id:updateId,isArchived:true,archivedAt:'2026-08-02T00:00:00.000Z',outcome:'archived'},correlationId:'323e4567-e89b-42d3-a456-426614174000'},error:null});
    await expect(setMarketNewsArchiveState({updateId,archived:true})).resolves.toMatchObject({id:updateId,isArchived:true,outcome:'archived'});
    expect(invokeSecureFunction).toHaveBeenNthCalledWith(2,'market-updates-archive',{action:'set_archive_state',updateId,archived:true});
  });

  it('rejects malformed successful responses instead of pretending the mutation succeeded',async()=>{
    // The sentence is the one the SERVICE wrote about its own state, not the
    // classifier's generic "could not complete this operation" — which used to
    // replace it and named nothing. See `operationalIssue.pure.ts`.
    invokeSecureFunction.mockResolvedValue({data:{ok:true},error:null});
    await expect(setMarketNewsArchiveState({updateId,archived:true})).rejects.toThrow('Archive operation returned an invalid response.');
    expect(invokeSecureFunction).toHaveBeenCalledTimes(2);
  });
});
