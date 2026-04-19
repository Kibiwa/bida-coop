// pages/guarantor-confirm.js
//
// This is the URL the BIDA app emails to guarantors:
//   https://bida.pamojapay.co/guarantor-confirm?token=xxx
//
// It simply server-redirects to the API route that does the real work.
// No client JS needed — pure server-side redirect.

export async function getServerSideProps({ query }) {
  const token = query.token || "";
  const done  = query.done  || "";

  // Build redirect URL to the API handler
  const params = new URLSearchParams({ token });
  if (done) params.set("done", done);

  return {
    redirect: {
      destination: `/api/confirm-guarantor?${params.toString()}`,
      permanent: false,
    },
  };
}

// This component never renders — getServerSideProps always redirects
export default function GuarantorConfirmPage() {
  return null;
}
